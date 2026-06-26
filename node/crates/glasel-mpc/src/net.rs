//! Party-to-party transport. Every multiplication gate and every output opening
//! sends one field element to each peer, tagged by a monotonic `round`, and
//! waits to receive the peers' elements for that round.
use crate::shamir::Fe;
use glasel_crypto::field::biguint_to_bytes_be;
use num_bigint::BigUint;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

/// Abstract synchronous transport between `n` parties indexed 1..=n.
pub trait Net: Send {
    fn id(&self) -> usize;
    fn n(&self) -> usize;
    /// Send `val` to party `to` for `round`.
    fn send(&self, to: usize, round: u64, val: Fe);
    /// Block until party `from` has sent its value for `round`.
    fn recv(&self, from: usize, round: u64) -> Fe;
}

/// In-process transport (one [`InMemoryNet`] per party, run on its own thread).
pub struct InMemoryNet {
    id: usize,
    n: usize,
    txs: Vec<Sender<(usize, u64, Vec<u8>)>>, // index j-1 → party j
    rx: Mutex<Receiver<(usize, u64, Vec<u8>)>>,
    buf: Mutex<HashMap<(usize, u64), Fe>>,
}

impl InMemoryNet {
    /// Build a fully-connected mesh of `n` parties.
    pub fn mesh(n: usize) -> Vec<InMemoryNet> {
        let mut txs = Vec::with_capacity(n);
        let mut rxs = Vec::with_capacity(n);
        for _ in 0..n {
            let (tx, rx) = std::sync::mpsc::channel();
            txs.push(tx);
            rxs.push(rx);
        }
        rxs.into_iter()
            .enumerate()
            .map(|(i, rx)| InMemoryNet {
                id: i + 1,
                n,
                txs: txs.clone(),
                rx: Mutex::new(rx),
                buf: Mutex::new(HashMap::new()),
            })
            .collect()
    }
}

impl Net for InMemoryNet {
    fn id(&self) -> usize {
        self.id
    }
    fn n(&self) -> usize {
        self.n
    }
    fn send(&self, to: usize, round: u64, val: Fe) {
        // A gone peer (e.g. one that aborted) just means non-delivery; the robust
        // open detects the missing/inconsistent share rather than crashing.
        let _ = self.txs[to - 1].send((self.id, round, val.to_bytes_be()));
    }
    fn recv(&self, from: usize, round: u64) -> Fe {
        let mut buf = self.buf.lock().unwrap();
        loop {
            if let Some(v) = buf.remove(&(from, round)) {
                return v;
            }
            let (f, r, bytes) = self.rx.lock().unwrap().recv().expect("sender dropped");
            buf.insert((f, r), BigUint::from_bytes_be(&bytes));
        }
    }
}

/// TCP transport for parties running as separate OS processes. Each ordered
/// pair shares one connection (the lower id dials the higher id's listener and
/// sends a 1-byte handshake); a reader thread per peer parses 40-byte frames
/// `[round: u64 BE][value: 32 bytes BE]` into a shared inbox.
pub struct TcpNet {
    id: usize,
    n: usize,
    writers: Mutex<HashMap<usize, TcpStream>>,
    inbox: Arc<(Mutex<HashMap<(usize, u64), Fe>>, Condvar)>,
}

const FRAME: usize = 40;

impl TcpNet {
    /// `addrs[k-1]` is the `host:port` of party `k` (including this one).
    pub fn connect(id: usize, n: usize, addrs: Vec<String>) -> std::io::Result<TcpNet> {
        let listener = TcpListener::bind(&addrs[id - 1])?;
        let inbox: Arc<(Mutex<HashMap<(usize, u64), Fe>>, Condvar)> =
            Arc::new((Mutex::new(HashMap::new()), Condvar::new()));
        let writers: Arc<Mutex<HashMap<usize, TcpStream>>> = Arc::new(Mutex::new(HashMap::new()));

        // Accept connections from lower-id peers (they dial us) on a thread.
        let expect_accepts = id - 1;
        let acc_writers = Arc::clone(&writers);
        let acc_inbox = Arc::clone(&inbox);
        let accept_handle = thread::spawn(move || {
            let mut got = 0;
            while got < expect_accepts {
                let (mut stream, _) = listener.accept().expect("accept failed");
                let mut h = [0u8; 1];
                stream.read_exact(&mut h).expect("handshake read");
                let peer = h[0] as usize;
                spawn_reader(peer, stream.try_clone().unwrap(), Arc::clone(&acc_inbox));
                acc_writers.lock().unwrap().insert(peer, stream);
                got += 1;
            }
        });

        // Dial higher-id peers, retrying until their listener is up.
        for j in (id + 1)..=n {
            let mut stream = loop {
                match TcpStream::connect(&addrs[j - 1]) {
                    Ok(s) => break s,
                    Err(_) => thread::sleep(Duration::from_millis(50)),
                }
            };
            stream.write_all(&[id as u8])?; // handshake
            stream.set_nodelay(true).ok();
            spawn_reader(j, stream.try_clone().unwrap(), Arc::clone(&inbox));
            writers.lock().unwrap().insert(j, stream);
        }

        accept_handle.join().expect("accept thread panicked");

        // Unwrap the writers Arc into the owned Mutex for the struct.
        let writers = Arc::try_unwrap(writers)
            .expect("writers still shared")
            .into_inner()
            .unwrap();
        Ok(TcpNet {
            id,
            n,
            writers: Mutex::new(writers),
            inbox,
        })
    }
}

fn spawn_reader(
    peer: usize,
    mut stream: TcpStream,
    inbox: Arc<(Mutex<HashMap<(usize, u64), Fe>>, Condvar)>,
) {
    stream.set_nodelay(true).ok();
    thread::spawn(move || {
        let mut frame = [0u8; FRAME];
        loop {
            if stream.read_exact(&mut frame).is_err() {
                break; // peer closed
            }
            let mut r = [0u8; 8];
            r.copy_from_slice(&frame[..8]);
            let round = u64::from_be_bytes(r);
            let val = BigUint::from_bytes_be(&frame[8..]);
            let (lock, cond) = &*inbox;
            lock.lock().unwrap().insert((peer, round), val);
            cond.notify_all();
        }
    });
}

impl Net for TcpNet {
    fn id(&self) -> usize {
        self.id
    }
    fn n(&self) -> usize {
        self.n
    }
    fn send(&self, to: usize, round: u64, val: Fe) {
        let mut frame = [0u8; FRAME];
        frame[..8].copy_from_slice(&round.to_be_bytes());
        frame[8..].copy_from_slice(&biguint_to_bytes_be(&val));
        let mut w = self.writers.lock().unwrap();
        let s = w.get_mut(&to).expect("no connection to peer");
        s.write_all(&frame).expect("send failed");
        s.flush().ok();
    }
    fn recv(&self, from: usize, round: u64) -> Fe {
        let (lock, cond) = &*self.inbox;
        let mut map = lock.lock().unwrap();
        loop {
            if let Some(v) = map.remove(&(from, round)) {
                return v;
            }
            map = cond.wait(map).unwrap();
        }
    }
}

// ── Authenticated + encrypted mesh (Noise) ──────────────────────────────────
pub use secure_net::SecureTcpNet;

mod secure_net {
    use super::*;
    use crate::secure;
    use snow::TransportState;

    type Inbox = Arc<(Mutex<HashMap<(usize, u64), Fe>>, Condvar)>;

    /// Drop-in [`Net`] like [`TcpNet`], but every connection is a mutually-
    /// authenticated, encrypted Noise channel. Each peer's static key is checked
    /// against its registered identity (`peer_pks`), so an unknown or spoofed
    /// peer cannot join. Reads happen off the transport lock to avoid blocking
    /// the writer.
    pub struct SecureTcpNet {
        id: usize,
        n: usize,
        writers: Mutex<HashMap<usize, TcpStream>>,
        transports: HashMap<usize, Arc<Mutex<TransportState>>>,
        inbox: Inbox,
    }

    impl SecureTcpNet {
        /// `addrs[k-1]` and `peer_pks[k-1]` are party `k`'s address and Noise
        /// static public key; `my_private` is this party's static private key.
        pub fn connect(
            id: usize,
            n: usize,
            addrs: Vec<String>,
            my_private: &[u8],
            peer_pks: &[Vec<u8>],
        ) -> std::io::Result<SecureTcpNet> {
            // Bound the whole mesh setup so a missing/dead peer fails the session
            // cleanly (the daemon skips/retries) instead of hanging forever.
            Self::connect_timeout(id, n, addrs, my_private, peer_pks, Duration::from_secs(30))
        }

        /// Like [`connect`](Self::connect) but with an explicit deadline covering
        /// the entire handshake (dialing higher peers + accepting lower peers).
        /// Returns [`std::io::ErrorKind::TimedOut`] if the mesh isn't up in time.
        pub fn connect_timeout(
            id: usize,
            n: usize,
            addrs: Vec<String>,
            my_private: &[u8],
            peer_pks: &[Vec<u8>],
            timeout: Duration,
        ) -> std::io::Result<SecureTcpNet> {
            use std::io::{Error, ErrorKind};
            use std::time::Instant;
            let deadline = Instant::now() + timeout;
            let listener = TcpListener::bind(&addrs[id - 1])?;
            listener.set_nonblocking(true)?; // poll accepts against the deadline
            let inbox: Inbox = Arc::new((Mutex::new(HashMap::new()), Condvar::new()));
            let writers: Arc<Mutex<HashMap<usize, TcpStream>>> =
                Arc::new(Mutex::new(HashMap::new()));
            let transports: Arc<Mutex<HashMap<usize, Arc<Mutex<TransportState>>>>> =
                Arc::new(Mutex::new(HashMap::new()));

            // Accept inbound connections from lower-id peers (we are responder).
            let expect_accepts = id - 1;
            let (a_priv, a_pks) = (my_private.to_vec(), peer_pks.to_vec());
            let (a_w, a_t, a_in) = (
                Arc::clone(&writers),
                Arc::clone(&transports),
                Arc::clone(&inbox),
            );
            let accept_handle = thread::spawn(move || -> std::io::Result<()> {
                use std::io::{Error, ErrorKind};
                use std::time::Instant;
                let mut got = 0;
                while got < expect_accepts {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            stream.set_nonblocking(false)?; // the handshake uses blocking IO
                            let (transport, remote) = secure::handshake(
                                &mut stream,
                                false,
                                &a_priv,
                                None,
                            )
                            .map_err(|e| {
                                Error::new(ErrorKind::Other, format!("responder handshake: {e}"))
                            })?;
                            // Identify + authenticate the peer by its static key.
                            let peer = a_pks
                                .iter()
                                .position(|k| k == &remote)
                                .map(|i| i + 1)
                                .ok_or_else(|| {
                                    Error::new(ErrorKind::PermissionDenied, "unknown peer key")
                                })?;
                            register(peer, stream, transport, &a_w, &a_t, &a_in);
                            got += 1;
                        }
                        Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                            if Instant::now() >= deadline {
                                return Err(Error::new(
                                    ErrorKind::TimedOut,
                                    "timed out waiting for inbound peers",
                                ));
                            }
                            thread::sleep(Duration::from_millis(50));
                        }
                        Err(e) => return Err(e),
                    }
                }
                Ok(())
            });

            // Dial higher-id peers (we are initiator), retrying until they listen
            // or the deadline passes.
            for j in (id + 1)..=n {
                let mut stream = loop {
                    match TcpStream::connect(&addrs[j - 1]) {
                        Ok(s) => break s,
                        Err(_) => {
                            if Instant::now() >= deadline {
                                return Err(Error::new(
                                    ErrorKind::TimedOut,
                                    format!("timed out dialing peer {j}"),
                                ));
                            }
                            thread::sleep(Duration::from_millis(50));
                        }
                    }
                };
                let (transport, _) =
                    secure::handshake(&mut stream, true, my_private, Some(&peer_pks[j - 1]))
                        .map_err(|e| {
                            Error::new(ErrorKind::Other, format!("initiator handshake: {e}"))
                        })?;
                register(j, stream, transport, &writers, &transports, &inbox);
            }

            // Propagate accept-side errors (incl. timeout) instead of hanging.
            accept_handle.join().expect("accept thread panicked")?;

            let writers = Arc::try_unwrap(writers)
                .expect("writers shared")
                .into_inner()
                .unwrap();
            let transports = Arc::try_unwrap(transports)
                .expect("transports shared")
                .into_inner()
                .unwrap();
            Ok(SecureTcpNet {
                id,
                n,
                writers: Mutex::new(writers),
                transports,
                inbox,
            })
        }
    }

    fn register(
        peer: usize,
        stream: TcpStream,
        transport: TransportState,
        writers: &Arc<Mutex<HashMap<usize, TcpStream>>>,
        transports: &Arc<Mutex<HashMap<usize, Arc<Mutex<TransportState>>>>>,
        inbox: &Inbox,
    ) {
        let t = Arc::new(Mutex::new(transport));
        let read_stream = stream.try_clone().expect("clone stream");
        writers.lock().unwrap().insert(peer, stream);
        transports.lock().unwrap().insert(peer, Arc::clone(&t));
        spawn_secure_reader(peer, read_stream, t, Arc::clone(inbox));
    }

    fn spawn_secure_reader(
        peer: usize,
        mut read_stream: TcpStream,
        transport: Arc<Mutex<TransportState>>,
        inbox: Inbox,
    ) {
        thread::spawn(move || loop {
            let ct = match secure::read_len_frame(&mut read_stream) {
                Ok(c) => c,
                Err(_) => break, // peer closed
            };
            let pt = {
                let mut t = transport.lock().unwrap();
                match secure::open(&mut t, &ct) {
                    Ok(p) => p,
                    Err(_) => break,
                }
            };
            if pt.len() < 8 {
                continue;
            }
            let mut r = [0u8; 8];
            r.copy_from_slice(&pt[..8]);
            let round = u64::from_be_bytes(r);
            let val = BigUint::from_bytes_be(&pt[8..]);
            let (lock, cond) = &*inbox;
            lock.lock().unwrap().insert((peer, round), val);
            cond.notify_all();
        });
    }

    impl Net for SecureTcpNet {
        fn id(&self) -> usize {
            self.id
        }
        fn n(&self) -> usize {
            self.n
        }
        fn send(&self, to: usize, round: u64, val: Fe) {
            let mut frame = [0u8; FRAME];
            frame[..8].copy_from_slice(&round.to_be_bytes());
            frame[8..].copy_from_slice(&biguint_to_bytes_be(&val));
            // Encrypt under the transport lock, then write off-lock.
            let ct = {
                let mut t = self.transports.get(&to).expect("no peer").lock().unwrap();
                secure::seal(&mut t, &frame).expect("seal failed")
            };
            let mut w = self.writers.lock().unwrap();
            secure::write_len_frame(w.get_mut(&to).expect("no connection"), &ct)
                .expect("send failed");
        }
        fn recv(&self, from: usize, round: u64) -> Fe {
            let (lock, cond) = &*self.inbox;
            let mut map = lock.lock().unwrap();
            loop {
                if let Some(v) = map.remove(&(from, round)) {
                    return v;
                }
                map = cond.wait(map).unwrap();
            }
        }
    }
}

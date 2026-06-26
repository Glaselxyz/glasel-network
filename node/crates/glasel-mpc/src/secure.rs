//! Authenticated + encrypted node transport via the Noise protocol (`snow`).
//!
//! Production MPC channels must be mutually authenticated and encrypted; rolling
//! that by hand is exactly the kind of crypto you shouldn't. We use the
//! **Noise XX** handshake (`Noise_XX_25519_ChaChaPoly_BLAKE2s`) — the same
//! pattern libp2p uses — which gives both parties each other's static public
//! key and a forward-secret session. We then verify the peer's static key
//! against the identity key it registered on-chain, rejecting impersonation/MITM.
//!
//! This is the default transport for the MPC mesh (`SecureTcpNet`); the plaintext
//! `TcpNet` remains only for local debugging (`--insecure`).
use snow::{Builder, TransportState};
use std::io::{self, Read, Write};

const PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";

fn ioerr<E: std::fmt::Display>(e: E) -> io::Error {
    io::Error::new(io::ErrorKind::Other, e.to_string())
}

/// Generate a node identity keypair (X25519, Noise static key) → (private, public).
pub fn generate_static_keypair() -> (Vec<u8>, Vec<u8>) {
    let kp = Builder::new(PARAMS.parse().unwrap())
        .generate_keypair()
        .expect("keygen");
    (kp.private, kp.public)
}

fn read_frame<S: Read>(s: &mut S) -> io::Result<Vec<u8>> {
    let mut len = [0u8; 2];
    s.read_exact(&mut len)?;
    let mut buf = vec![0u8; u16::from_be_bytes(len) as usize];
    s.read_exact(&mut buf)?;
    Ok(buf)
}

fn write_frame<S: Write>(s: &mut S, data: &[u8]) -> io::Result<()> {
    s.write_all(&(data.len() as u16).to_be_bytes())?;
    s.write_all(data)?;
    s.flush()
}

fn verify_peer(hs: &snow::HandshakeState, expected_peer_pk: &[u8]) -> io::Result<()> {
    match hs.get_remote_static() {
        Some(pk) if pk == expected_peer_pk => Ok(()),
        Some(_) => Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "peer static key mismatch",
        )),
        None => Err(ioerr("no remote static key after handshake")),
    }
}

/// Run the Noise XX handshake on a borrowed stream and return the resulting
/// transport state plus the peer's static public key. If `expected_peer` is
/// `Some`, the peer key is verified (initiator path, where we know who we dial);
/// if `None`, the caller identifies the peer from the returned key (responder
/// path, where we accept an inbound connection). Used by `SecureTcpNet`, which
/// needs the read/write halves separate from the transport state.
pub fn handshake<S: Read + Write>(
    stream: &mut S,
    initiator: bool,
    my_private: &[u8],
    expected_peer: Option<&[u8]>,
) -> io::Result<(TransportState, Vec<u8>)> {
    let builder = Builder::new(PARAMS.parse().unwrap()).local_private_key(my_private);
    let mut hs = if initiator {
        builder.build_initiator()
    } else {
        builder.build_responder()
    }
    .map_err(ioerr)?;
    let mut buf = vec![0u8; 1024];
    if initiator {
        let n = hs.write_message(&[], &mut buf).map_err(ioerr)?;
        write_frame(stream, &buf[..n])?;
        let m = read_frame(stream)?;
        hs.read_message(&m, &mut buf).map_err(ioerr)?;
        let n = hs.write_message(&[], &mut buf).map_err(ioerr)?;
        write_frame(stream, &buf[..n])?;
    } else {
        let m = read_frame(stream)?;
        hs.read_message(&m, &mut buf).map_err(ioerr)?;
        let n = hs.write_message(&[], &mut buf).map_err(ioerr)?;
        write_frame(stream, &buf[..n])?;
        let m = read_frame(stream)?;
        hs.read_message(&m, &mut buf).map_err(ioerr)?;
    }
    let remote = hs
        .get_remote_static()
        .ok_or_else(|| ioerr("no remote static key"))?
        .to_vec();
    if let Some(exp) = expected_peer {
        if remote != exp {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "peer static key mismatch",
            ));
        }
    }
    Ok((hs.into_transport_mode().map_err(ioerr)?, remote))
}

/// Encrypt one message with the Noise transport (returns the AEAD ciphertext).
pub fn seal(transport: &mut TransportState, plaintext: &[u8]) -> io::Result<Vec<u8>> {
    let mut buf = vec![0u8; plaintext.len() + 16];
    let n = transport
        .write_message(plaintext, &mut buf)
        .map_err(ioerr)?;
    buf.truncate(n);
    Ok(buf)
}

/// Decrypt one Noise transport message.
pub fn open(transport: &mut TransportState, ciphertext: &[u8]) -> io::Result<Vec<u8>> {
    let mut buf = vec![0u8; ciphertext.len()];
    let n = transport
        .read_message(ciphertext, &mut buf)
        .map_err(ioerr)?;
    buf.truncate(n);
    Ok(buf)
}

/// Length-prefixed frame I/O (so reads happen off the transport lock).
pub fn write_len_frame<S: Write>(s: &mut S, data: &[u8]) -> io::Result<()> {
    write_frame(s, data)
}
pub fn read_len_frame<S: Read>(s: &mut S) -> io::Result<Vec<u8>> {
    read_frame(s)
}

/// A mutually-authenticated, encrypted channel over a byte stream.
pub struct SecureChannel<S> {
    stream: S,
    transport: TransportState,
}

impl<S: Read + Write> SecureChannel<S> {
    /// Initiator side (the dialer). Verifies the responder's static key equals
    /// `expected_peer_pk`.
    pub fn handshake_initiator(
        mut stream: S,
        my_private: &[u8],
        expected_peer_pk: &[u8],
    ) -> io::Result<Self> {
        let mut hs = Builder::new(PARAMS.parse().unwrap())
            .local_private_key(my_private)
            .build_initiator()
            .map_err(ioerr)?;
        let mut buf = vec![0u8; 1024];
        let n = hs.write_message(&[], &mut buf).map_err(ioerr)?; // -> e
        write_frame(&mut stream, &buf[..n])?;
        let m = read_frame(&mut stream)?; // <- e, ee, s, es
        hs.read_message(&m, &mut buf).map_err(ioerr)?;
        let n = hs.write_message(&[], &mut buf).map_err(ioerr)?; // -> s, se
        write_frame(&mut stream, &buf[..n])?;
        verify_peer(&hs, expected_peer_pk)?;
        let transport = hs.into_transport_mode().map_err(ioerr)?;
        Ok(Self { stream, transport })
    }

    /// Responder side (the acceptor). Verifies the initiator's static key.
    pub fn handshake_responder(
        mut stream: S,
        my_private: &[u8],
        expected_peer_pk: &[u8],
    ) -> io::Result<Self> {
        let mut hs = Builder::new(PARAMS.parse().unwrap())
            .local_private_key(my_private)
            .build_responder()
            .map_err(ioerr)?;
        let mut buf = vec![0u8; 1024];
        let m = read_frame(&mut stream)?; // <- e
        hs.read_message(&m, &mut buf).map_err(ioerr)?;
        let n = hs.write_message(&[], &mut buf).map_err(ioerr)?; // -> e, ee, s, es
        write_frame(&mut stream, &buf[..n])?;
        let m = read_frame(&mut stream)?; // <- s, se
        hs.read_message(&m, &mut buf).map_err(ioerr)?;
        verify_peer(&hs, expected_peer_pk)?;
        let transport = hs.into_transport_mode().map_err(ioerr)?;
        Ok(Self { stream, transport })
    }

    /// Encrypt and send a message (AEAD via the Noise transport).
    pub fn send(&mut self, plaintext: &[u8]) -> io::Result<()> {
        let mut buf = vec![0u8; plaintext.len() + 16];
        let n = self
            .transport
            .write_message(plaintext, &mut buf)
            .map_err(ioerr)?;
        write_frame(&mut self.stream, &buf[..n])
    }

    /// Receive and decrypt a message.
    pub fn recv(&mut self) -> io::Result<Vec<u8>> {
        let ct = read_frame(&mut self.stream)?;
        let mut buf = vec![0u8; ct.len()];
        let n = self.transport.read_message(&ct, &mut buf).map_err(ioerr)?;
        buf.truncate(n);
        Ok(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    #[test]
    fn mutual_auth_and_encrypted_round_trip() {
        let (a_priv, a_pub) = generate_static_keypair();
        let (b_priv, b_pub) = generate_static_keypair();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let server = thread::spawn(move || {
            let (s, _) = listener.accept().unwrap();
            let mut ch = SecureChannel::handshake_responder(s, &b_priv, &a_pub).unwrap();
            assert_eq!(ch.recv().unwrap(), b"hello-mpc");
            ch.send(b"ack").unwrap();
        });

        let s = TcpStream::connect(addr).unwrap();
        let mut ch = SecureChannel::handshake_initiator(s, &a_priv, &b_pub).unwrap();
        ch.send(b"hello-mpc").unwrap();
        assert_eq!(ch.recv().unwrap(), b"ack");
        server.join().unwrap();
    }

    #[test]
    fn rejects_impersonation() {
        // Responder expects peer key `a_pub`, but the dialer authenticates with a
        // DIFFERENT identity → the responder's verify_peer must reject it.
        let (_a_priv, a_pub) = generate_static_keypair();
        let (imposter_priv, _imposter_pub) = generate_static_keypair();
        let (b_priv, b_pub) = generate_static_keypair();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let server = thread::spawn(move || {
            let (s, _) = listener.accept().unwrap();
            // Expecting a_pub, but the imposter will present a different key.
            SecureChannel::handshake_responder(s, &b_priv, &a_pub).is_err()
        });

        let s = TcpStream::connect(addr).unwrap();
        // Best-effort: the initiator may error when the responder drops.
        let _ = SecureChannel::handshake_initiator(s, &imposter_priv, &b_pub);
        assert!(
            server.join().unwrap(),
            "responder must reject an unexpected peer key"
        );
    }
}

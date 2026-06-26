//! End-to-end MPC over the authenticated, encrypted Noise mesh (`SecureTcpNet`).
//! Three parties handshake (mutual auth), then run the full BGW computation with
//! every wire-message encrypted — proving the secure transport is a drop-in for
//! the plaintext `TcpNet`.
use glasel_circuit::ir::{Circuit, Gate};
use glasel_mpc::dkg::run_dkg;
use glasel_mpc::net::SecureTcpNet;
use glasel_mpc::secure::generate_static_keypair;
use glasel_mpc::{deal, run_party};
use num_bigint::BigUint;
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn mpc_runs_over_encrypted_mesh() {
    // order_notional: price * quantity
    let circuit = Circuit {
        input_count: 2,
        gates: vec![Gate::Mul { a: 0, b: 1 }],
        outputs: vec![2],
    };

    // Per-party Noise identity keys; everyone knows everyone's public key.
    let keys: Vec<(Vec<u8>, Vec<u8>)> = (0..3).map(|_| generate_static_keypair()).collect();
    let peer_pks: Vec<Vec<u8>> = keys.iter().map(|(_, pk)| pk.clone()).collect();
    let addrs: Vec<String> = (0..3).map(|i| format!("127.0.0.1:{}", 18120 + i)).collect();

    let mut rng = StdRng::seed_from_u64(9);
    let per_party = deal(
        &[BigUint::from(1000u64), BigUint::from(7u64)],
        3,
        1,
        &mut rng,
    );

    let circuit = Arc::new(circuit);
    let peer_pks = Arc::new(peer_pks);
    let addrs = Arc::new(addrs);

    let handles: Vec<_> = (1..=3)
        .map(|id| {
            let (my_priv, _) = keys[id - 1].clone();
            let shares = per_party[id - 1].clone();
            let (circuit, peer_pks, addrs) = (
                Arc::clone(&circuit),
                Arc::clone(&peer_pks),
                Arc::clone(&addrs),
            );
            thread::spawn(move || {
                let net = SecureTcpNet::connect(id, 3, (*addrs).clone(), &my_priv, &peer_pks)
                    .expect("secure connect");
                let mut rng = StdRng::seed_from_u64(100 + id as u64);
                run_party(&circuit, &shares, &net, 1, &mut rng)
            })
        })
        .collect();

    let outputs: Vec<Vec<BigUint>> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    for out in &outputs {
        assert_eq!(
            out,
            &vec![BigUint::from(7000u64)],
            "MPC over the encrypted mesh must yield price*quantity"
        );
    }
}

#[test]
fn live_dkg_over_secure_mesh_yields_group_key() {
    // Per-session DKG run over the real authenticated, encrypted mesh: 3 nodes
    // handshake, deal verifiable shares, and each derives its secret share + the
    // shared group key — no node ever holds the whole key.
    use glasel_bls::bls::{combine_words, group_sign, verify_words};

    let keys: Vec<(Vec<u8>, Vec<u8>)> = (0..3).map(|_| generate_static_keypair()).collect();
    let peer_pks: Vec<Vec<u8>> = keys.iter().map(|(_, pk)| pk.clone()).collect();
    let addrs: Vec<String> = (0..3).map(|i| format!("127.0.0.1:{}", 18140 + i)).collect();
    let peer_pks = Arc::new(peer_pks);
    let addrs = Arc::new(addrs);

    let handles: Vec<_> = (1..=3)
        .map(|id| {
            let (my_priv, _) = keys[id - 1].clone();
            let (peer_pks, addrs) = (Arc::clone(&peer_pks), Arc::clone(&addrs));
            thread::spawn(move || {
                let net = SecureTcpNet::connect(id, 3, (*addrs).clone(), &my_priv, &peer_pks)
                    .expect("secure connect");
                let mut rng = StdRng::seed_from_u64(2000 + id as u64);
                run_dkg(&net, 3, 1, &mut rng).expect("DKG over secure mesh must succeed")
            })
        })
        .collect();
    let outs: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    for o in &outs {
        assert_eq!(
            o.group_pk, outs[0].group_pk,
            "all nodes derive the same group key over the secure mesh"
        );
    }
    // The distributed key works: any t+1 partials verify under the group key.
    let msg = b"glasel:live-dkg-over-mesh";
    let partial = |o: &glasel_mpc::dkg::DkgOutput| group_sign(&o.secret_share, msg).0;
    let sig = combine_words(&[1, 2], &[partial(&outs[0]), partial(&outs[1])]).unwrap();
    assert!(
        verify_words(msg, &sig, &outs[0].group_pk),
        "DKG-over-mesh threshold signature must verify"
    );
}

#[test]
fn connect_times_out_when_peer_absent() {
    // Fault tolerance: a node whose peer never comes up must fail the session
    // cleanly (TimedOut) rather than hang the daemon forever.
    let (my_priv, my_pub) = generate_static_keypair();
    let (_, peer_pub) = generate_static_keypair();
    let addrs = vec!["127.0.0.1:18130".to_string(), "127.0.0.1:18131".to_string()];
    let peer_pks = vec![my_pub, peer_pub];

    let start = Instant::now();
    // Party 1 dials party 2, which never starts → bounded dial times out.
    let res =
        SecureTcpNet::connect_timeout(1, 2, addrs, &my_priv, &peer_pks, Duration::from_millis(500));
    assert!(res.is_err(), "connect must error when the peer is absent");
    assert_eq!(res.err().unwrap().kind(), std::io::ErrorKind::TimedOut);
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "must fail fast, not hang"
    );
}

//! Exponential-backoff retry for flaky external calls (RPC submits, etc.).
//!
//! The result submitter must tolerate transient RPC failures (load-balanced
//! public RPCs, OP-stack gas-estimation hiccups, mempool races) rather than
//! dropping a computation on the first error.
use std::time::Duration;

/// Run `f` up to `max_attempts` times, sleeping `base`, `2·base`, `4·base`, …
/// between failures. Returns the last error if all attempts fail.
pub async fn retry_with_backoff<F, Fut, T, E>(
    max_attempts: u32,
    base: Duration,
    mut f: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut delay = base;
    for attempt in 1..=max_attempts {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                if attempt == max_attempts {
                    return Err(e);
                }
                tracing::warn!(
                    "attempt {attempt}/{max_attempts} failed: {e}; retrying in {delay:?}"
                );
                tokio::time::sleep(delay).await;
                delay *= 2;
            }
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[tokio::test]
    async fn succeeds_after_transient_failures() {
        let calls = Cell::new(0u32);
        let r: Result<u32, String> = retry_with_backoff(5, Duration::from_millis(1), || {
            calls.set(calls.get() + 1);
            let n = calls.get();
            async move {
                if n < 3 {
                    Err(format!("transient {n}"))
                } else {
                    Ok(n)
                }
            }
        })
        .await;
        assert_eq!(r, Ok(3), "succeeds on the 3rd attempt");
        assert_eq!(calls.get(), 3);
    }

    #[tokio::test]
    async fn gives_up_after_max_attempts() {
        let calls = Cell::new(0u32);
        let r: Result<u32, String> = retry_with_backoff(3, Duration::from_millis(1), || {
            calls.set(calls.get() + 1);
            async { Err::<u32, _>("always fails".to_string()) }
        })
        .await;
        assert!(r.is_err());
        assert_eq!(calls.get(), 3, "tried exactly max_attempts times");
    }
}

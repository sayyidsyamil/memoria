//! The single boundary for synchronous command work on Tokio's blocking pool.

pub(crate) async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    run_blocking_labeled("Task panicked", work).await
}

pub(crate) async fn run_blocking_labeled<T: Send + 'static>(
    label: &'static str,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| format!("{label}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "current_thread")]
    async fn runs_work_on_a_blocking_pool_thread() {
        let caller = std::thread::current().id();
        let worker = run_blocking(|| std::thread::current().id()).await.unwrap();
        assert_ne!(worker, caller);
    }

    #[tokio::test]
    async fn preserves_work_results_and_errors() {
        assert_eq!(run_blocking(|| 42).await.unwrap(), 42);
        let failure: Result<(), String> = Err("work failed".to_string());
        assert_eq!(
            run_blocking(move || failure.clone()).await.unwrap(),
            Err("work failed".to_string())
        );
    }

    #[tokio::test]
    async fn reports_worker_panics() {
        let error = run_blocking(|| panic!("worker failure")).await.unwrap_err();
        assert!(error.starts_with("Task panicked:"));
        assert!(error.contains("worker failure"));
    }

    #[tokio::test]
    async fn preserves_contextual_join_failure_wording() {
        let error = run_blocking_labeled("MCP status check failed", || panic!("worker failure"))
            .await
            .unwrap_err();
        assert!(error.starts_with("MCP status check failed:"));
    }
}

use super::*;

#[test]
fn test_shell_git_config_is_detected_once_per_process() {
    let cache = OnceLock::new();
    let mut detections = 0;
    let mut detect = || {
        detections += 1;
        Some(ShellGitConfig {
            git_path: Some(PathBuf::from("/opt/homebrew/bin/git")),
            path: Some(OsString::from("/opt/homebrew/bin:/usr/bin")),
        })
    };

    let first = cached_shell_git_config(&cache, &mut detect);
    let second = cached_shell_git_config(&cache, &mut detect);

    assert_eq!(detections, 1);
    for config in [first, second] {
        let config = config.expect("cached shell config");
        assert_eq!(
            config.git_path,
            Some(PathBuf::from("/opt/homebrew/bin/git"))
        );
    }
}

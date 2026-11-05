use super::*;
#[cfg(desktop)]
use std::cell::RefCell;
#[cfg(desktop)]
use std::os::unix::process::ExitStatusExt;
#[cfg(desktop)]
use std::process::{ExitStatus, Output};
#[cfg(desktop)]
use std::rc::Rc;

#[test]
fn parses_title_bar_action_values() {
    for (value, expected) in [
        ("Fill", Some(TitleBarDoubleClickAction::Fill)),
        ("zoom", Some(TitleBarDoubleClickAction::Fill)),
        ("Minimize", Some(TitleBarDoubleClickAction::Minimize)),
        ("No Action", Some(TitleBarDoubleClickAction::None)),
        ("tile", None),
    ] {
        assert_eq!(parse_title_bar_double_click_action(value), expected);
    }

    for (value, expected) in [
        ("1", Some(TitleBarDoubleClickAction::Minimize)),
        ("false", Some(TitleBarDoubleClickAction::Fill)),
        ("maybe", None),
    ] {
        assert_eq!(parse_legacy_title_bar_double_click_action(value), expected);
    }
}

#[test]
fn resolves_title_bar_action_preferences() {
    assert_eq!(
        resolve_with(&[
            ("AppleActionOnDoubleClick", "No Action"),
            ("AppleMiniaturizeOnDoubleClick", "1"),
        ]),
        TitleBarDoubleClickAction::None
    );
    assert_eq!(
        resolve_with(&[("AppleMiniaturizeOnDoubleClick", "1")]),
        TitleBarDoubleClickAction::Minimize
    );
    assert_eq!(
        resolve_with(&[
            ("AppleActionOnDoubleClick", "tile"),
            ("AppleMiniaturizeOnDoubleClick", "1"),
        ]),
        TitleBarDoubleClickAction::Minimize
    );
    assert_eq!(resolve_with(&[]), TitleBarDoubleClickAction::Fill);
}

#[test]
fn parses_defaults_output_variants() {
    for (code, stdout, expected) in [
        (0, b" Maximize \n".to_vec(), Some("Maximize")),
        (1, b"Minimize\n".to_vec(), None),
        (0, b"   \n".to_vec(), None),
        (0, vec![0xff], None),
    ] {
        assert_eq!(
            parse_defaults_read_output(output(code, stdout)),
            expected.map(str::to_string)
        );
    }
}

#[test]
fn routes_title_bar_actions_to_expected_window_calls() {
    for (action, state, expected_calls) in [
        (
            TitleBarDoubleClickAction::Fill,
            Ok(false),
            vec!["is_maximized", "maximize"],
        ),
        (
            TitleBarDoubleClickAction::Fill,
            Ok(true),
            vec!["is_maximized", "unmaximize"],
        ),
        (
            TitleBarDoubleClickAction::Minimize,
            Ok(false),
            vec!["minimize"],
        ),
        (TitleBarDoubleClickAction::None, Ok(false), Vec::new()),
    ] {
        let (result, calls) = run_action(action, state, Ok(()), Ok(()), Ok(()));
        assert_eq!(result, Ok(()));
        assert_eq!(calls, expected_calls);
    }
}

#[test]
fn skips_min_size_updates_for_windows_fullscreen_or_maximized_windows() {
    for (is_fullscreen, is_maximized) in [(true, false), (false, true), (true, true)] {
        assert!(!should_apply_window_min_size_constraints(
            true,
            is_fullscreen,
            is_maximized
        ));
    }

    assert!(should_apply_window_min_size_constraints(true, false, false));
    assert!(should_apply_window_min_size_constraints(false, true, true));
}

#[test]
fn propagates_title_bar_action_errors() {
    for (state, maximize, unmaximize, expected) in [
        (Err("state"), Ok(()), Ok(()), "state"),
        (Ok(false), Err("maximize"), Ok(()), "maximize"),
        (Ok(true), Ok(()), Err("unmaximize"), "unmaximize"),
    ] {
        let (result, _) = run_action(
            TitleBarDoubleClickAction::Fill,
            state,
            maximize,
            unmaximize,
            Ok(()),
        );
        assert_eq!(result, Err(expected.to_string()));
    }
}

fn exit_status(code: i32) -> ExitStatus {
    ExitStatus::from_raw(code << 8)
}

fn output(code: i32, stdout: Vec<u8>) -> Output {
    Output {
        status: exit_status(code),
        stdout,
        stderr: Vec::new(),
    }
}

fn resolve_with(values: &[(&str, &str)]) -> TitleBarDoubleClickAction {
    resolve_title_bar_double_click_action(|key| {
        values
            .iter()
            .find(|(candidate, _)| *candidate == key)
            .map(|(_, value)| (*value).to_string())
    })
}

fn run_action(
    action: TitleBarDoubleClickAction,
    state: Result<bool, &'static str>,
    maximize: Result<(), &'static str>,
    unmaximize: Result<(), &'static str>,
    minimize: Result<(), &'static str>,
) -> (Result<(), String>, Vec<&'static str>) {
    let calls = Rc::new(RefCell::new(Vec::new()));
    let state_calls = Rc::clone(&calls);
    let maximize_calls = Rc::clone(&calls);
    let unmaximize_calls = Rc::clone(&calls);
    let minimize_calls = Rc::clone(&calls);
    let result = apply_title_bar_double_click_action(
        action,
        move || {
            state_calls.borrow_mut().push("is_maximized");
            state.map_err(str::to_string)
        },
        move || {
            maximize_calls.borrow_mut().push("maximize");
            maximize.map_err(str::to_string)
        },
        move || {
            unmaximize_calls.borrow_mut().push("unmaximize");
            unmaximize.map_err(str::to_string)
        },
        move || {
            minimize_calls.borrow_mut().push("minimize");
            minimize.map_err(str::to_string)
        },
    );
    let call_log = calls.borrow().clone();
    (result, call_log)
}

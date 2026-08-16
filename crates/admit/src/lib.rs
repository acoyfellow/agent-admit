mod command;
mod lockfile;

pub use command::{admit_command, extract_bash_target_paths};
pub use lockfile::{admit_lockfile, parse_policy, policy_sha256};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    pub allow: bool,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Action {
    Bash { command: String },
    Write { path: String, content: String },
    Edit { path: String, payload: String },
    Lockfile {
        text: String,
        #[serde(rename = "policyJson")]
        policy_json: String,
    },
}

#[cfg(target_arch = "wasm32")]
mod wasm_abi {
    use super::{admit, Action, Decision};
    use std::alloc::{alloc, dealloc, Layout};
    use std::ptr;
    use std::slice;

    #[no_mangle]
    pub extern "C" fn admit_alloc(size: u32) -> *mut u8 {
        if size == 0 {
            return ptr::null_mut();
        }
        let Ok(layout) = Layout::from_size_align(size as usize, 1) else {
            return ptr::null_mut();
        };
        unsafe { alloc(layout) }
    }

    #[no_mangle]
    pub extern "C" fn admit_free(ptr: *mut u8, size: u32) {
        if ptr.is_null() || size == 0 {
            return;
        }
        if let Ok(layout) = Layout::from_size_align(size as usize, 1) {
            unsafe { dealloc(ptr, layout) }
        }
    }

    #[no_mangle]
    pub extern "C" fn admit_json(ptr: *const u8, len: u32) -> u64 {
        if ptr.is_null() {
            return pack(b"{\"allow\":false,\"reason\":\"null input\"}");
        }
        let bytes = unsafe { slice::from_raw_parts(ptr, len as usize) };
        let raw = match std::str::from_utf8(bytes) {
            Ok(value) => value,
            Err(_) => return pack(b"{\"allow\":false,\"reason\":\"invalid utf8\"}"),
        };
        let action: Action = match serde_json::from_str(raw) {
            Ok(value) => value,
            Err(_) => return pack(b"{\"allow\":false,\"reason\":\"invalid action json\"}"),
        };
        let decision: Decision = admit(action);
        let encoded = serde_json::to_vec(&decision).unwrap_or_else(|_| {
            b"{\"allow\":false,\"reason\":\"encode failed\"}".to_vec()
        });
        pack(&encoded)
    }

    fn pack(bytes: &[u8]) -> u64 {
        let size = bytes.len();
        let dest = admit_alloc(size as u32);
        if dest.is_null() {
            return 0;
        }
        unsafe {
            ptr::copy_nonoverlapping(bytes.as_ptr(), dest, size);
        }
        ((dest as u64) << 32) | (size as u64)
    }
}

pub fn admit(action: Action) -> Decision {
    match action {
        Action::Bash { command } => {
            let target_paths = extract_bash_target_paths(&command);
            admit_command("bash", &command, &target_paths)
        }
        Action::Write { path, content } => admit_command("write", &content, std::slice::from_ref(&path)),
        Action::Edit { path, payload } => admit_command("edit", &payload, std::slice::from_ref(&path)),
        Action::Lockfile { text, policy_json } => {
            let result = admit_lockfile(&text, &policy_json);
            Decision {
                allow: result.allow,
                reason: result.reason,
            }
        }
    }
}

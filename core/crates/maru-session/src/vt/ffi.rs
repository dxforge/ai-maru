use std::ffi::c_void;

pub type GhosttyTerminal = *mut c_void;
pub type GhosttyFormatter = *mut c_void;
pub type GhosttyAllocator = c_void;
pub type GhosttySnapshotDecoder = *mut c_void;

include!(concat!(env!("OUT_DIR"), "/ghostty_enums.rs"));

unsafe extern "C" {
    pub fn ghostty_terminal_new(
        allocator: *const GhosttyAllocator,
        terminal: *mut GhosttyTerminal,
        cols: u16,
        rows: u16,
    ) -> i32;

    pub fn ghostty_terminal_free(terminal: GhosttyTerminal);

    pub fn ghostty_terminal_resize(
        terminal: GhosttyTerminal,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    ) -> i32;

    pub fn ghostty_terminal_set(
        terminal: GhosttyTerminal,
        option: i32,
        value: *const c_void,
    ) -> i32;

    pub fn ghostty_terminal_vt_write(terminal: GhosttyTerminal, data: *const u8, len: usize);

    pub fn ghostty_terminal_get(terminal: GhosttyTerminal, data: i32, out: *mut c_void) -> i32;

    pub fn ghostty_terminal_select_all(
        terminal: GhosttyTerminal,
        out_selection: *mut GhosttySelection,
    ) -> i32;

    pub fn ghostty_formatter_terminal_new(
        allocator: *const GhosttyAllocator,
        formatter: *mut GhosttyFormatter,
        terminal: GhosttyTerminal,
        options: GhosttyFormatterTerminalOptions,
    ) -> i32;

    pub fn ghostty_formatter_format_alloc(
        formatter: GhosttyFormatter,
        allocator: *const GhosttyAllocator,
        out_ptr: *mut *mut u8,
        out_len: *mut usize,
    ) -> i32;

    pub fn ghostty_formatter_free(formatter: GhosttyFormatter);

    pub fn ghostty_free(allocator: *const GhosttyAllocator, ptr: *mut u8, len: usize);

    pub fn ghostty_snapshot_encode_alloc(
        terminal: GhosttyTerminal,
        allocator: *const GhosttyAllocator,
        out_ptr: *mut *mut u8,
        out_len: *mut usize,
    ) -> i32;

    pub fn ghostty_snapshot_decoder_new_buf(
        allocator: *const GhosttyAllocator,
        decoder: *mut GhosttySnapshotDecoder,
        ptr: *const u8,
        len: usize,
    ) -> i32;

    pub fn ghostty_snapshot_decoder_decode(
        decoder: GhosttySnapshotDecoder,
        terminal: *mut GhosttyTerminal,
    ) -> i32;

    pub fn ghostty_snapshot_decoder_free(decoder: GhosttySnapshotDecoder);
}

/// 필드는 안 읽지만 `node` 포인터의 8바이트 정렬을 맞추려고 바이트 배열 대신 그대로 옮긴다.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyGridRef {
    pub size: usize,
    pub node: *mut c_void,
    pub x: u16,
    pub y: u16,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttySelection {
    pub size: usize,
    pub start: GhosttyGridRef,
    pub end: GhosttyGridRef,
    pub rectangle: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttyFormatterScreenExtra {
    pub size: usize,
    pub cursor: bool,
    pub style: bool,
    pub hyperlink: bool,
    pub protection: bool,
    pub kitty_keyboard: bool,
    pub charsets: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttyFormatterTerminalExtra {
    pub size: usize,
    pub palette: bool,
    pub modes: bool,
    pub scrolling_region: bool,
    pub tabstops: bool,
    pub pwd: bool,
    pub keyboard: bool,
    pub screen: GhosttyFormatterScreenExtra,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyFormatterTerminalOptions {
    pub size: usize,
    pub emit: i32,
    pub unwrap: bool,
    pub trim: bool,
    pub extra: GhosttyFormatterTerminalExtra,
    pub selection: *const GhosttySelection,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttyTerminalScrollbar {
    pub total: u64,
    pub offset: u64,
    pub len: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::offset_of;

    unsafe extern "C" {
        /// 프로세스 수명 내내 유효한 NUL 종단 문자열을 돌려준다.
        fn ghostty_type_json() -> *const std::ffi::c_char;
    }

    #[test]
    fn sized_structs_match_the_built_library_layout() {
        let json = unsafe { std::ffi::CStr::from_ptr(ghostty_type_json()) }
            .to_str()
            .unwrap();
        let layouts: serde_json::Value = serde_json::from_str(json).unwrap();

        macro_rules! check {
            ($ty:ident { $($field:ident),* $(,)? }) => {
                assert_layout(
                    &layouts,
                    stringify!($ty),
                    size_of::<$ty>(),
                    align_of::<$ty>(),
                    &[$((stringify!($field), offset_of!($ty, $field))),*],
                )
            };
        }
        check!(GhosttyGridRef { size, node, x, y });
        check!(GhosttySelection {
            size,
            start,
            end,
            rectangle
        });
        check!(GhosttyTerminalScrollbar { total, offset, len });
        check!(GhosttyFormatterScreenExtra {
            size,
            cursor,
            style,
            hyperlink,
            protection,
            kitty_keyboard,
            charsets,
        });
        check!(GhosttyFormatterTerminalExtra {
            size,
            palette,
            modes,
            scrolling_region,
            tabstops,
            pwd,
            keyboard,
            screen,
        });
        check!(GhosttyFormatterTerminalOptions {
            size,
            emit,
            unwrap,
            trim,
            extra,
            selection,
        });
    }

    fn assert_layout(
        layouts: &serde_json::Value,
        name: &str,
        size: usize,
        align: usize,
        fields: &[(&str, usize)],
    ) {
        let want = &layouts[name];
        assert!(!want.is_null(), "{name} 이 ghostty_type_json() 에 없다");
        assert_eq!(want["size"].as_u64(), Some(size as u64), "{name}: size");
        assert_eq!(want["align"].as_u64(), Some(align as u64), "{name}: align");
        let want_fields = want["fields"].as_object().unwrap();
        assert_eq!(
            want_fields.len(),
            fields.len(),
            "{name}: 필드 수 — 라이브러리 {:?}",
            want_fields.keys().collect::<Vec<_>>()
        );
        for (field, offset) in fields {
            assert_eq!(
                want_fields[*field]["offset"].as_u64(),
                Some(*offset as u64),
                "{name}.{field}: offset"
            );
        }
    }
}

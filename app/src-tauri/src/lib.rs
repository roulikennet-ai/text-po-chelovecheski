//! Точка входа Tauri-оболочки.
//!
//! Весь интерфейс и логика живут во фронтенде (React + TS). Оболочка даёт
//! нативное окно, доступ к файловой системе и в будущем — к локальной модели.
//! Хранилище сейчас на `localStorage`; переход на SQLite делается за тем же
//! интерфейсом `src/state/storage.ts`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("ошибка при запуске приложения");
}

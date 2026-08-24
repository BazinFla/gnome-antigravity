import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Asynchronously loads the raw binary contents of a file.
 * @param {Gio.File|string} fileOrPath
 * @returns {Promise<Uint8Array|null>}
 */
export function loadFileContentsAsync(fileOrPath) {
    const file = typeof fileOrPath === 'string' ? Gio.File.new_for_path(fileOrPath) : fileOrPath;
    return new Promise((resolve) => {
        file.load_contents_async(null, (f, res) => {
            try {
                const [ok, contents] = f.load_contents_finish(res);
                resolve(ok ? contents : null);
            } catch (e) {
                resolve(null);
            }
        });
    });
}

/**
 * Asynchronously loads the UTF-8 text contents of a file.
 * @param {Gio.File|string} fileOrPath
 * @returns {Promise<string|null>}
 */
export async function loadTextFileAsync(fileOrPath) {
    const contents = await loadFileContentsAsync(fileOrPath);
    if (!contents) return null;
    try {
        return new TextDecoder('utf-8', { fatal: false }).decode(contents);
    } catch (e) {
        return null;
    }
}

/**
 * Asynchronously replaces the contents of a file with the given text string.
 * @param {Gio.File|string} fileOrPath
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export function replaceFileContentsAsync(fileOrPath, text) {
    const file = typeof fileOrPath === 'string' ? Gio.File.new_for_path(fileOrPath) : fileOrPath;
    const bytes = new TextEncoder().encode(text);
    return new Promise((resolve) => {
        file.replace_contents_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (f, res) => {
                try {
                    const [ok] = f.replace_contents_finish(res);
                    resolve(!!ok);
                } catch (e) {
                    resolve(false);
                }
            }
        );
    });
}

/**
 * Asynchronously enumerates child files/directories in a directory.
 * @param {Gio.File|string} dirOrPath
 * @param {string} attributes
 * @returns {Promise<Array<Gio.FileInfo>>}
 */
export function enumerateChildrenAsync(dirOrPath, attributes = 'standard::name') {
    const dir = typeof dirOrPath === 'string' ? Gio.File.new_for_path(dirOrPath) : dirOrPath;
    return new Promise((resolve) => {
        dir.enumerate_children_async(attributes, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (d, res) => {
            try {
                const enumerator = d.enumerate_children_finish(res);
                const results = [];
                const readNextBatch = () => {
                    enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, null, (e, res2) => {
                        try {
                            const files = e.next_files_finish(res2);
                            if (files && files.length > 0) {
                                results.push(...files);
                                readNextBatch();
                            } else {
                                resolve(results);
                            }
                        } catch (err) {
                            resolve(results);
                        }
                    });
                };
                readNextBatch();
            } catch (e) {
                resolve([]);
            }
        });
    });
}

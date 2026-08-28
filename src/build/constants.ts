/**
 * Build Constants
 */

/**
 * The MSBuild configuration DebugSharp builds and launches.
 *
 * Deliberately fixed rather than selectable. C# Dev Kit already owns a
 * configuration picker in the status bar, and it exposes no way to read its
 * selection — so a second selector could only ever disagree with it, silently
 * building Debug while the visible picker said Release. Matching `dotnet
 * build`'s own default keeps our commands predictable; use Dev Kit's build
 * commands when you need another configuration.
 */
export const BUILD_CONFIGURATION = 'Debug';

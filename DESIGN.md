# Design

## Current direction

bryantOS, a chrome Y2K desktop with Windows XP-inspired windows and an interactive terminal. This implements the user's September 2026 redesign request and supersedes the previous dark, restrained composition. Register: brand. Voice: reflective, tactile, curious.

Physical scene: a recruiter or engineering peer opens the portfolio on a laptop in daylight and finds a customized early-2000s desktop. Pale metal surfaces keep the desktop open and legible; a deep navy terminal provides the focal point.

## Composition and imagery

The initial desktop opens the terminal and, on wide screens, a small readme window. A chrome wordmark sits above the terminal, eight desktop shortcuts run down the left, and a silver taskbar with a green Start button anchors the bottom. Mobile uses four columns and two rows of shortcuts above the foreground window. Short, wide screens place all eight shortcuts across the top.

LinkedIn, GitHub, and Instagram have matching illustrated metal icons and open the respective profiles in new tabs. Instagram uses the original portfolio's bryant.pdf profile; LinkedIn and GitHub retain the current profile URLs. All shortcuts remain visible above the taskbar.

Original SVG artwork supplies interlocking chrome rings, four-point stars, perspective grid lines, the wordmark, and illustrated desktop icons. These are code-native vector assets, with no bitmap generation required. The existing portrait appears in About. Chrome lettering is a decorative SVG wordmark; readable portfolio headings use solid colors.

About is a Myspace-inspired profile inside the chrome browser frame: a blue masthead, portrait and contact links, interests, orange blurb headings, and blue experience and education panels. Contact is an AOL Instant Messenger-inspired window with a gold running figure, buddy links, an away message, and an email composer. These apps use matching SVG icons in the desktop, Start menu, title bars, and taskbar. The contact form explains that messages arrive by email and retains the existing Formspree endpoint.

The resume opens as a Word-inspired document window with a blue W icon, document section links, a ruler, paper on a gray workspace, and Print and Open PDF controls. It embeds `assets/resume.html` as the single source of resume text. Open PDF opens the existing PDF in a separate tab; Print targets only the resume document. External profile links in the document also open separately. All three apps retain the desktop's typography, chrome surfaces, and XP controls. Their interiors adapt to the window width, including when manually resized on a large screen.

## Palette and typography

Named roles: pale blue metal for the desktop, cobalt for the active title bar, deep navy for the terminal, and green for Start and status indicators. Semantic CSS colors use OKLCH. Windows have beveled borders, restrained drop shadows, reflective title bars, and distinct minimize, maximize, and close controls. An optional midnight wallpaper persists locally; content windows retain their readable contrast.

Typography follows the physical references of desktop labels, terminal output, and early web pages:

- Tahoma with Verdana and sans-serif fallbacks for interface controls.
- Trebuchet MS with Tahoma fallbacks for content headings.
- Lucida Console, Monaco, and Courier New for the terminal.
- Arial bold italic for the original chrome wordmark.

These are system font stacks and require no font downloads. Catalog references: [Tahoma](https://learn.microsoft.com/en-us/typography/font-list/tahoma) and [Trebuchet MS](https://learn.microsoft.com/en-us/typography/font-list/trebuchet-ms).

## Interaction

All portfolio content is static HTML, enhanced by dependency-free JavaScript. Desktop icons, terminal shortcuts, and Start entries open About, Work, Toolkit, Resume, Contact, the undergraduate archive, and Read me. The `resume` and `open resume` commands open the document window.

All eight windows support focus, dragging, resizing from every edge and corner, minimize, maximize, restore, and close. Pointer resizing works with a mouse or touch. The bottom-right resize grip is keyboard focusable: arrow keys adjust dimensions by 10 pixels, or 40 pixels with Shift. Minimum dimensions keep controls usable; desktop bounds keep windows within reach. Maximize hides the resize handles, and Restore returns to the custom size. Closing or minimizing retains window dimensions and form drafts for the visit.

Open windows remain accessible in the taskbar. Show desktop temporarily minimizes windows and restores their previous foreground order. Viewport changes, reopening, and Show desktop restoration constrain moved and resized windows to the current desktop. Reset desktop clears custom positions and dimensions and restores the initial arrangement.

Terminal commands: help, about, work, projects, skills, archive, resume, contact, whoami, theme, clear, cls, home, ls, dir, pwd, open, github, linkedin, date, history, and echo. Commands are parsed as text and never evaluated as code. Help entries are clickable. Tab completes commands; arrow keys traverse history and preserve the current draft. Shift+Tab and Tab on an empty prompt follow normal keyboard navigation. The prompt stays fixed beneath a scrolling transcript.

## Accessibility and resilience

Use semantic landmarks, labeled controls, visible focus, native details elements for contribution disclosures, and native form validation. Window openings announce their names and move keyboard focus appropriately; closing returns focus. Resizing announces the final dimensions, and the keyboard grip has associated instructions. Start supports arrow navigation and Escape. Do not trap focus. Respect reduced motion, preserve deep links, and keep all core content accessible without JavaScript, including the embedded resume. Wallpaper changes work even when local storage is blocked; copying email has a readable fallback. The existing Formspree action is retained.

## Local development

This is a static site with no build step. Run a local HTTP server from the repository, for example `python3 -m http.server 8000`, and open `http://localhost:8000`.

## Verification

Review wide desktop, laptop, tablet, narrow phone, and landscape layouts. Check command execution, history, autocomplete, unknown input, window controls, drag bounds, taskbar restoration, Start navigation, deep links, wallpaper persistence, reduced motion, and no-JavaScript access. Validate the contact form without sending a message. Check local assets and browser errors. Refresh the social preview from the finished desktop.

## Completed browser review

Verified in a Chromium browser at 1440 × 900, 1366 × 768, 768 × 1024, 390 × 844, 320 × 568, and 844 × 390. The terminal prompt stays visible, and the transcript does not scroll horizontally. Command execution, clickable help, history and draft restoration, autocomplete, literal input handling, window controls, dragging, Start keyboard navigation, desktop restoration, wallpaper persistence, deep links, and mobile content scrolling passed. The resume loads, contact validation works without sending a message, clipboard and storage fallbacks work, reduced motion is honored, and the static portfolio remains accessible with JavaScript disabled. No missing assets or browser exceptions were found.

The Myspace, AIM, and Word additions were reviewed at desktop, tablet, narrow phone, and landscape widths. All eight windows passed pointer resizing, keyboard resizing, custom-size restoration after maximizing, and dimension retention after minimizing and reopening. All eight resize directions, minimum dimensions, desktop bounds, touch resizing, and viewport changes were checked. Resume section navigation, PDF loading, and the document-specific print action passed. The contact form retains its draft during resizing and continues to validate without sending a test message. HTML lint, JavaScript syntax, and local asset checks passed.

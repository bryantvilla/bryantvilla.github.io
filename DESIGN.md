# Design

## Current direction

bryantOS, a chrome Y2K desktop with Windows XP-inspired windows and an interactive terminal. This implements the user's September 2026 redesign request and supersedes the previous dark, restrained composition. Register: brand. Voice: reflective, tactile, curious.

Physical scene: a recruiter or engineering peer opens the portfolio on a laptop in daylight and finds a customized early-2000s desktop. Pale metal surfaces keep the desktop open and legible; a deep navy terminal provides the focal point.

## Composition and imagery

The initial desktop opens the terminal and, on wide screens, a small readme window. A chrome wordmark sits above the terminal, eight desktop shortcuts run down the left, and a silver taskbar with a green Start button anchors the bottom. Mobile uses four columns and two rows of shortcuts above the foreground window. Short, wide screens place all eight shortcuts across the top.

LinkedIn, GitHub, and Instagram have matching illustrated metal icons and open the respective profiles in new tabs. Instagram uses the original portfolio's bryant.pdf profile; LinkedIn and GitHub retain the current profile URLs. All shortcuts remain visible above the taskbar.

Original SVG artwork supplies interlocking chrome rings, four-point stars, perspective grid lines, and illustrated desktop icons. The BryantOS wordmark uses Pirata One blackletter outlines with pale silver reflections and a dark metal edge. The favicon uses the exact same capital B on a navy tile. A separate portrait composition of the existing wallpaper keeps the rings and stars visible on phones. These are code-native vector assets, with no bitmap generation required. The existing portrait appears in About. Chrome lettering is a decorative SVG wordmark; readable portfolio headings use solid colors.

The terminal introduction uses a grid with the name, role, and bio grouped in one column and a separate ASCII art column. The donut is absolutely positioned inside its own grid area, so its animation and intrinsic height cannot create a gap between the name and role. Narrow windows place the art beside the name and let the role and bio span both columns. The welcome block has no percentage minimum height, avoiding cyclic sizing in an automatically sized terminal. Decorative smileys, mail icons, and external-link arrows use shared SVG symbols so iOS does not substitute emoji artwork.

About is a Myspace-inspired profile inside the chrome browser frame: a blue masthead, portrait and contact links, interests, orange blurb headings, and blue experience and education panels. Contact is an AOL Instant Messenger-inspired window with a gold running figure, buddy links, an away message, and an email composer. These apps use matching SVG icons in the desktop, Start menu, title bars, and taskbar. The contact form explains that messages arrive by email and retains the existing Formspree endpoint.

The resume opens as a Word-inspired document window with a blue W icon, document section links, a ruler, paper on a gray workspace, and Print and Open PDF controls. It embeds `assets/resume.html` as the single source of resume text. Open PDF opens the existing PDF in a separate tab; Print targets only the resume document. External profile links in the document also open separately. All three apps retain the desktop's typography, chrome surfaces, and XP controls. Their interiors adapt to the window width, including when manually resized on a large screen.

My toolkit uses a Windows Media Player-inspired interior: a blue library sidebar, a dark visualization pane, striped tool lists, and a silver transport bar. Four collections retain the original skills and workflow content. Previous and Next browse collections; Play and Pause control a decorative spectrum visualization with no audio. Visualization starts paused, respects reduced motion, and pauses when another window is active. Collection links support direct URLs, and all collections remain readable without JavaScript and when printing.

My work uses an XP Explorer-inspired task pane, address bar, folder header, and contribution files. The sidebar opens the two original engineering stories; Expand all and Collapse all operate their native details disclosures. The original contribution text and deep links remain intact. Narrow windows move the task controls above the files. Both apps retain the shared window controls, resizing, system fonts, and chrome theme.

## Palette and typography

Named roles: pale blue metal for the desktop, cobalt for the active title bar, deep navy for the terminal, and green for Start and status indicators. Semantic CSS colors use OKLCH. Windows have beveled borders, restrained drop shadows, reflective title bars, and distinct minimize, maximize, and close controls. An optional midnight wallpaper persists locally; content windows retain their readable contrast.

Typography follows the physical references of desktop labels, terminal output, and early web pages:

- Tahoma with Verdana and sans-serif fallbacks for interface controls.
- Trebuchet MS with Tahoma fallbacks for content headings.
- Lucida Console, Monaco, and Courier New for the terminal.
- [Pirata One](https://fonts.google.com/specimen/Pirata+One) for the gothic chrome wordmark and B favicon, exported as SVG outlines. The SIL Open Font License is included at `assets/fonts/OFL-PirataOne.txt`.

Interface and content use system font stacks; the outlined brand assets require no runtime font downloads. Catalog references: [Tahoma](https://learn.microsoft.com/en-us/typography/font-list/tahoma) and [Trebuchet MS](https://learn.microsoft.com/en-us/typography/font-list/trebuchet-ms).

## Interaction

All portfolio content is static HTML, enhanced by dependency-free JavaScript. Desktop icons, terminal shortcuts, and Start entries open About, Work, Toolkit, Resume, Contact, the undergraduate archive, and Read me. The `resume` and `open resume` commands open the document window.

Desktop icons use single-click selection and double-click opening. Control/Command toggles additional icons; Shift selects a range. Dragging empty desktop space draws a translucent cobalt rectangle and selects the icons it intersects. Dragging any selected icon moves the whole group with its spacing intact and keeps it above the taskbar. Positions last for the visit and adapt to viewport changes. Pointer cancellation or Escape during a drag restores the original positions. Touch users tap once to select and again to open, or drag to move. Arrow keys navigate icons; Space toggles selection, Enter opens, Control/Command+A selects all, and Alt+arrow keys move the selection by 10px (40px with Shift). A visible desktop hint and screen-reader instructions explain the controls. Ordinary navigation links remain available without JavaScript.

Outbound links show an XP-style confirmation dialog with the destination and Continue/Cancel controls. This includes external profiles, terminal output links, PDFs, email links, modified/middle clicks, and links in both the embedded and standalone resume. Internal app shortcuts and resume section navigation stay within the desktop. The dialog defaults focus to Cancel, supports Escape, confines keyboard focus while open, and restores focus to the source link on dismissal. Embedded resume links use the parent desktop dialog so the prompt is not clipped by the document frame. New tabs open only from the Continue gesture and retain `noopener,noreferrer`.

All eight windows support focus, dragging, resizing from every edge and corner, minimize, maximize, restore, and close. Dragging can move windows past any viewport edge; offscreen portions are clipped by the browser. Pointer resizing works with a mouse or touch. The bottom-right resize grip is keyboard focusable: arrow keys adjust dimensions by 10 pixels, or 40 pixels with Shift. Minimum dimensions keep controls usable; resizing stays within desktop bounds. Maximize hides the resize handles, and Restore returns to the custom size. Closing or minimizing retains window dimensions and form drafts for the visit.

Open windows remain accessible in the taskbar. Terminal stays pinned in the first taskbar slot even after it is closed, and its button reopens it. Show desktop temporarily minimizes windows and restores their previous foreground order. Viewport changes, reopening, and Show desktop restoration constrain moved and resized windows to the current desktop. Reset desktop clears custom window positions and dimensions, icon positions, and icon selection, then restores the initial arrangement.

On mobile, default window positions follow the measured shortcut rows so every icon label remains visible. Windows retain absolute positioning for touch dragging and resizing. The terminal's last-login timestamp reflects the visitor's local date and time at page load.

Window motion uses the browser's Web Animations API without additional dependencies. Openings reveal the app over 320ms, minimizing shrinks it toward its taskbar button over 260ms, and restoring reverses that path. Closing fades and contracts over 180ms. Maximize and restore apply the destination layout once and animate its transform, preserving custom dimensions. Initial windows arrive 70ms apart. Start opens from the taskbar, with smaller feedback on controls, desktop shortcuts, terminal responses, and contribution disclosures. Transitions use the existing quint easing curve and animate transforms and opacity.

Animations can be interrupted by another window action. Exiting windows become inert immediately, then hide when the effect finishes. Dragging, resizing, viewport changes, printing, and backgrounding settle pending motion. Reduced-motion preferences skip transitions and update live, including stopping the terminal's ASCII animation. Window controls also work when the animation API is unavailable.

The contact composer submits to its existing Formspree endpoint using a background POST with `Accept: application/json`, following [Formspree's AJAX submission pattern](https://formspree.io/blog/formspree-ajax/). Visitors remain on the desktop. Sending shows progress and prevents duplicate submissions. A confirmed successful response replaces the form with an AIM-styled receipt and a Send another message button. Validation failures, service errors, interrupted connections, unrecognized responses, and a 20-second timeout preserve the draft and offer retry or direct email. Confirmation means the service accepted the message, not that Bryant has read it. A response received while another app is active does not move keyboard focus. Without JavaScript, the form retains its standard POST fallback.

Terminal commands: help, about, work, projects, skills, archive, resume, contact, whoami, theme, clear, cls, home, ls, dir, pwd, open, github, linkedin, date, history, and echo. Commands are parsed as text and never evaluated as code. Help entries are clickable. Tab completes commands; arrow keys traverse history and preserve the current draft. Shift+Tab and Tab on an empty prompt follow normal keyboard navigation. The prompt stays fixed beneath a scrolling transcript.

## Accessibility and resilience

Use semantic landmarks, labeled controls, visible focus, native details elements for contribution disclosures, and native form validation. Window openings announce their names and move keyboard focus appropriately; closing returns focus. Resizing announces the final dimensions, and the keyboard grip has associated instructions. Start supports arrow navigation and Escape. Do not trap focus. Respect reduced motion, preserve deep links, and keep all core content accessible without JavaScript, including the embedded resume. Wallpaper changes work even when local storage is blocked; copying email has a readable fallback. The existing Formspree action is retained.

## Local development

This is a static site with no build step. Run a local HTTP server from the repository, for example `python3 -m http.server 8000`, and open `http://localhost:8000`.

## Verification

Review wide desktop, laptop, tablet, narrow phone, and landscape layouts. Check command execution, history, autocomplete, unknown input, window controls, drag bounds, taskbar restoration, Start navigation, deep links, wallpaper persistence, reduced motion, and no-JavaScript access. Validate the contact form without sending a message. Run `node scripts/verify-site.js` for local assets and JavaScript syntax, `npx --yes htmlhint index.html assets/resume.html` for HTML, and `node scripts/verify-desktop.mjs` for browser interaction checks (Node 22+, with `CHROME_PATH` pointing to Chromium when not using the default macOS Brave installation). Browser artifacts are saved in a temporary directory. Check local assets and browser errors. Refresh the social preview from the finished desktop.

## Completed browser review

The desktop selection and chrome branding update passed `scripts/verify-desktop.mjs` in Chromium at 1920 × 1080, 1440 × 900, 1366 × 768, 1050 × 900, 768 × 1024, 390 × 844, 320 × 568, and 844 × 390. Checks covered mouse and touch selection, group movement, marquee selection, modifiers, keyboard movement, drag cancellation, reset, viewport bounds, pinned Terminal reopening, maximized and manually resized terminal spacing, redirect confirmation and cancellation, modal focus, modified clicks, PDFs, email, both resume contexts, and the static fallback. No external destinations were opened or messages sent. HTML lint, JavaScript syntax, local assets, and the social preview were also checked.

Verified in a Chromium browser at 1440 × 900, 1366 × 768, 768 × 1024, 390 × 844, 320 × 568, and 844 × 390. The terminal prompt stays visible, and the transcript does not scroll horizontally. Command execution, clickable help, history and draft restoration, autocomplete, literal input handling, window controls, dragging, Start keyboard navigation, desktop restoration, wallpaper persistence, deep links, and mobile content scrolling passed. The resume loads, contact validation works without sending a message, clipboard and storage fallbacks work, reduced motion is honored, and the static portfolio remains accessible with JavaScript disabled. No missing assets or browser exceptions were found.

The Myspace, AIM, and Word additions were reviewed at desktop, tablet, narrow phone, and landscape widths. All eight windows passed pointer resizing, keyboard resizing, custom-size restoration after maximizing, and dimension retention after minimizing and reopening. All eight resize directions, minimum dimensions, desktop bounds, touch resizing, and viewport changes were checked. Resume section navigation, PDF loading, and the document-specific print action passed. The contact form retains its draft during resizing and continues to validate without sending a test message. HTML lint, JavaScript syntax, and local asset checks passed.

The animation and inline-contact update passed the existing desktop, mobile, keyboard, resize, and no-JavaScript checks. Additional browser checks covered all eight animated window lifecycles, interrupted minimize/close transitions, repeated maximize/restore, Show desktop stacking, rapid Start toggles, reset, live reduced-motion changes, viewport changes during motion, and the animation API fallback. Simulated Formspree responses verified inline success, required validation, duplicate prevention, error recovery, retained drafts, background responses, and timeouts at desktop and phone widths. External Formspree requests were blocked during verification; no live messages were sent.

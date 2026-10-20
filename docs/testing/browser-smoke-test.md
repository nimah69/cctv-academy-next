# Browser smoke-test design

The browser workflow is separate from the fast static/unit workflow to keep normal CI feedback quick. It installs a pinned Playwright version and Chromium, serves the single-file app over localhost, then checks:
- RTL/Persian initialization and 14-chapter data availability.
- Mobile viewport width and no horizontal overflow.
- Correct quiz submission and persistence after reload.
- Context-specific pass/fail feedback and retry clearing both saved answer and temporary simulator result.
- Workshop iframe open/close.
- Core app availability when Google Fonts endpoints are blocked.
- Desktop viewport width and uncaught browser exceptions.

These are smoke tests, not exhaustive testing of every control, every workshop or every Android/WebView variant. Real-device Android testing remains a separate manual requirement.

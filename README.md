# Research Desk

A shared blotter for reading a business from the filings. Collecting ideas, opening a report, and kicking off a deep dive all run on the server when you ask for them.

Locally the blotter is `data/watchlist.json` and filings sit in `.cache/`. On the Oracle VM those same files live on its disk (`DESK_STORE=disk`). A push to `main` typechecks, then publishes the app to that machine.

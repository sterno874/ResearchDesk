# Research Desk

A shared blotter for reading a business from the filings. Collecting ideas, opening a report, and kicking off a deep dive all run on the server when you ask for them.

Locally the blotter is `data/watchlist.json` and filings sit in `.cache/`. In production both live in Postgres (`DATABASE_URL`). A push to `main` typechecks, then deploys the server.

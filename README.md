# Research Desk

A shared blotter for reading a business from the filings. Collecting ideas, opening a report, and kicking off a deep dive all run on the server when you ask for them.

Locally the blotter is `data/watchlist.json` and filings sit in `.cache/`. On the Oracle VM both live in Postgres (`DATABASE_URL` in `/etc/research-desk.env`). A push to `main` typechecks, then publishes the app to that machine. The deploy replaces the app directory, so the blotter cannot live in there.

# Verified Rental House Finder

A verified rental house finder and broker transparency system for Ethiopia.

## Features

- Search rental houses by city, area, price, rooms and type.
- User roles: seekers, owners, brokers, admin.
- National ID and phone verification for brokers.
- Admin approval workflow for listings and broker verification.
- Reporting system for fake or suspicious listings.
- Favorite houses and reviews.

## Tech Stack

- Frontend: static HTML/CSS/JavaScript
- Backend: Node.js + Express
- Database: PostgreSQL

## Setup

1. Copy `.env.example` to `.env` and update values.
2. Install dependencies:

```bash
npm install
```

3. Start the app locally:

```bash
npm run dev
```

4. If you do not use `DATABASE_URL`, make sure your local PostgreSQL user and password are set in `.env`.

5. The app initializes the schema automatically on startup by reading `models/schema.sql`.

6. Open a second terminal and run the share command if you want a temporary public link:

```bash
npm run share
```

The command prints a temporary public URL, for example:

```bash
https://fifty-ghosts-reply.loca.lt
```

This only works while your server is running and the terminal stays open.

## Deploying for a permanent teacher link

To let your teacher open the app any time without your computer staying online, deploy the app to a hosting platform.

### Recommended steps

1. Push this project to GitHub.
2. Choose a cloud platform such as:
   - Railway
   - Render
   - Fly.io
   - Heroku
3. Create a PostgreSQL database on the platform or use the provider's managed PostgreSQL service.
4. Configure environment variables on the host:
   - `PORT`
   - `DATABASE_URL` (preferred) or `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   - `JWT_SECRET`
5. Deploy the app and copy the production URL.

### Useful files included

- `Procfile` — tells platforms how to run the app
- `Dockerfile` — container support if the host uses Docker
- `.dockerignore` — avoids uploading local files like `node_modules` and `uploads`

### Example production URL

After deployment, your teacher can use the permanent URL from the host, for example:

```bash
https://your-app-name.onrender.com
```

## Project Structure

- `server.js`: main Express server and API routes
- `config/db.js`: database connection helper
- `public/`: static website pages, CSS, and JavaScript
- `public/dashboard.html`: user dashboard for seekers, owners/brokers, and admin links
- `public/add-listing.html`: house posting form for owners and brokers
- `public/admin.html`: admin review dashboard for pending listings and brokers
- `models/schema.sql`: PostgreSQL schema for users, listings, reports, favorites, and reviews

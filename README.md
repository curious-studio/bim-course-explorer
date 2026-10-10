# BIM Course Explorer

Interactive dashboard for exploring BIM course data from `bim.inclass.today`, including enrollment history, section cards, faculty filters, delivery mix, classrooms, and subject load.

## Structure

- `public/` contains the dashboard HTML, CSS, and browser JavaScript.
- `scripts/build.sh` builds the deployable worker artifact into `dist/`.
- `scripts/validate-artifact.mjs` checks that the built artifact serves the dashboard.

## Build

```bash
bash scripts/build.sh
node scripts/validate-artifact.mjs
```

## GitHub Pages

GitHub Pages is deployed by `.github/workflows/pages.yml`. The workflow builds a static copy of the dashboard into `pages-dist/` and snapshots the BIM JSON endpoints into matching `api/` paths, so the published Pages site does not depend on the ChatGPT Sites worker.

The workflow runs on pushes to `main`, manual dispatch, and a daily schedule.

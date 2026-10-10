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


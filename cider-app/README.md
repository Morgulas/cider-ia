# Cider Application

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 13.2.2.

## Table of Contents

- [Useful Commands](#useful-commands)
- [Updating Dependencies](#updating-dependencies)
- [Other](#other)
- [Update Longtable](#update-longtable)

# Useful Commands

## Local server

Run `npm run start` for a dev server. Navigate to `http://localhost:4200/`. The app will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

# Updating Dependencies

## List outdated dependencies
Run `npm outdated`

## Update all dependencies (from current to wanted)
Run `npm update`

## Update specific dependency
Run `ng update library@version` or `npm update library@version`. If it doesn't work use `ng update library@version --allow-dirty`.

## Save updated versions to package.json
Run `npm update --save`

## Install dependencies from package-lock.json only
Run `npm ci`

## Install updated dependencies from package.json
Run `npm install`

# Other

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).
Run `npm run test:ci` for a single headless run (as in CI), and `npm run lint` for ESLint.

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.

# Update Longtable
1. Uninstall the existing library version
    `npm uninstall oatear-longtable`
2. Install the new library version from the libs directory
    `npm install ./libs/oatear-longtable-0.1.6.tgz`

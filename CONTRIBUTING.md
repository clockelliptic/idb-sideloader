
## Development

The following tasks are available for `npm run`:

- `dev`: Run Vite in watch mode to detect changes to files during development
- `start`: Run Vite in host mode to work in a local development environment within this package, eliminating the need to test from a linked project
- `build`: Run Vite to build a production release distributable
- `build:types`: Run DTS Generator to build d.ts type declarations only

There are two strategies for development:

- With `dev` task, Vite compiles all modules to the `dist/` folder, as well as rollup of all types to a d.ts declaration file
- With `start` task, Vite hosts the index.html with real time HMR updates enabling development directly within this library without the need to link to other projects.

Rollup your exports to the top-level index.ts for inclusion into the build distributable.

For example, if you have a `utils/` folder that contains an `arrayUtils.ts` file.

/src/utils/arrayUtils.ts:
```ts
export const distinct = <T>(array: T[] = []) => [...new Set(array)];
```

Include that export in the top-level `index.ts` .

/src/index.ts
```ts
// Main library exports - these are packaged in your distributable
export { distinct } from "./utils/arrayUtils"
```



## Development Environment

Vite features a host mode to enable development with real time HMR updates directly from the library via the `start` script.

To test your library from within an app:

- **From your library**: run `npm link` or `yarn link` command to register the package
- **From your app**: run `npm link "mylib"` or `yarn link "mylib"` command to use the library inside your app during development

For UI projects, you may want to consider adding tools such as [Storybook](https://storybook.js.org/) to isolate UI component development by running a `storybook` script from this package.


## Development Cleanup

Once development completes, `unlink` both your library and test app projects.

- **From your app**: run `npm link "mylib"` or `yarn link "mylib"` command to use the library inside your app during development
- **From your library**: run `npm unlink` or `yarn unlink` command to register the package

If you mistakenly forget to `unlink`, you can manually clean up artifacts from `yarn` or `npm`.

For `yarn`, the `link` command creates symlinks which can be deleted from your home directory:
```
~/.config/yarn/link
```

For `npm`, the `link` command creates global packages which can be removed by executing:
```bash
sudo npm rm --global "mylib"
```

Confirm your npm global packages with the command:
```bash
npm ls --global --depth 0
```


## Release Publishing

Update your `package.json` to the next version number and tag a release.

If you are publishing to a private registry such as GitHub packages, update your `package.json` to include `publishConfig` and `repository`:

package.json:
```json
  "publishConfig": {
    "registry": "https://npm.pkg.github.com/@MyOrg"
  },
  "repository": "https://github.com/MyOrg/mylib.git",
```

For clean builds, you may want to install the `rimraf` package and add a `clean` or `prebuild` script to your `package.json` to remove any artifacts from your `dist/` folder.  Or, manually delete the `dist/` folder yourself.  Unless you are using a continuous integration service such as GitHub Actions, `npm publish` will ship anything inside the distributable folder.

package.json:
```json
  "scripts": {
    "clean": "rimraf dist"
  }
```

Before you submit for the first time, make sure your package name is available by using `npm search`.  If npm rejects your package name, update your `package.json` and resubmit.

```bash
npm search <term>
```

Once ready to submit your package to the NPM Registry, execute the following tasks via `npm` (or `yarn`):

```bash
npm run build
```

Assure the proper npm login:

```bash
npm login
```

Submit your package to the registry:

```bash
npm publish --access public
```

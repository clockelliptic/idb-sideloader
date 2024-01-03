# idb-sideloader.js

Licensed under the MIT license.

What is `idb-sideloader`? It's a tiny Javascript + TypeScript library that "sideloads" static assets (script, link, and img tags) on webpages using the fetch() API and caches them in an IndexedDB store to eliminate dependency on the standard browser static asset cache, and to eliminate HTTP requests on subsequent page loads. Javascript, CSS, and image assets are stored in IndexedDB as Blobs.

idb-sideloader makes use of [URLSearchParams Polyfill](https://github.com/jerrybendy/url-search-params-polyfill) for backward compatibility with browsers without support for `URLSearchParams.size` (i.e. Safari and some WebKit Chromium builds).

## Usage

To cache and sideload static assets:

- Change the original `src` (`href` for CSS) attribute on tags to `data-src`.
- Give tags a unique ID with `data-key`. The cached items are stored in the database with this key. The actual filenames of the assets can change freely, like in the case of JS build systems.
- Load and invoke indexed-cache at the end.

#### Simplest Usage - Vanilla HTML + Javascript Global Object

```html
<head>
	<script src="https://cdn.jsdelivr.net/npm/idb-sideloader@1.0.4/dist/index.iife.min.js"></script>
</head>
<body>
	<img data-src="https://your-url.com/your-image.jpg" />
	<script type="text/javascript">
		const ic = new IDBSideloader();
		ic.init().then(function() {
			ic.load();
		}).catch(function(err) {
			console.log("error loading indexed-cache", err)
		});
	</script>
</body>
```

#### Simplest Usage - Vanilla HTML + ESM Javascript

```html
<body>
	<img data-src="https://your-url.com/your-image.jpg" />
	<script type="module">
		import IDBSideloader from 'https://cdn.jsdelivr.net/npm/idb-sideloader@1.0.4/+esm'
		const ic = new IDBSideloader();
		ic.init().then(function() {
			ic.load();
		}).catch(function(err) {
			console.log("error loading indexed-cache", err)
		});
	</script>
</body>
```

#### Example - React + Recoil

Use-cases include webapps, PWAs, module federation, and other use-cases.

This pattern is useful in situations where an PWA isn't feasible (i.e. extending low-code platforms with federated react component modules), but where we still want to provide the user with progressive data loading for static assets.

The example below shows the following:

1. initializing the `IDBSideloader` cache object as a global state variable using RecoilJS
2. initializing / re-initializing the `IDBSideloader` cache object with a `useLayoutEffect` hook component
3. loading cached images when the user clicks on an image in an image gallery

```tsx
import { FunctionComponent, useLayoutEffect } from 'react';
import { atom, selector, useRecoilValue } from 'recoil';
import IDBSideloader from 'idb-sideloader';

// Initialize immediately so the state atom is never falsy
export const idbImgStoreAtom = atom({
  key: 'idb-image-store-atom',
  default: selector({
    key: 'idb-image-store-selector',
    get: async () => {
      const ic = new IDBSideloader({});
      await ic
        .init()
        .then(function () {
          ic.load();
        })
        .catch(function (err) {
          console.log('error loading indexed-cache', err);
        });
      return ic;
    },
  }),
});

// Re-initialize on initial app render to guarantee images are loaded
export const IDBSideloaderInitEffect: FunctionComponent = () => {
  const cache = useRecoilValue(idbImgStoreAtom);
  useLayoutEffect(
    () => {
      cache
        .init()
        .then(() => {
          cache.load();
        })
        .catch(console.error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      /** once */
    ]
  );
  return null;
};

// Load cache data when user-actions load images into the DOM
export const SelectedImage: FunctionComponent<{
	imgSrc: string,
	otherImages: string[]
}> = ({ imgSrc, otherImages }) => {
  const cache = useRecoilValue(idbImgStoreAtom);
	const [selectedImage, setSelectedImage] = useState(imgSrc);
	useLayoutEffect(() => {
			cache.load();
	}, [cache, selectedImage]);
	return (<>...</>)
};
```

#### Example - Load modern and legacy bundle conditionally

Here is an example on how to load modern(ESM) bundle and legacy bundle conditionally based on browser support.

```html
    <!-- Only modern browsers understand type=module and legacy browsers will skip this script -->
    <script type="module">
        // Use ESM bundle.
        import IDBSideloader from "https://cdn.jsdelivr.net/npm/idb-sideloader@1.0.4/+esm";
        const ic = new IDBSideloader();
        ic.init().then(function() {
            ic.load();
        }).catch(function(err) {
            console.log("error loading indexed-cache", err)
        })
    </script>

    <!-- This will only be executed on legacy browsers which doesn't support ES6 modules.
    Modern browsers ignore the script if its tagged `nomodule`. -->
    <script src="https://cdn.jsdelivr.net/npm/idb-sideloader@1.0.4/dist/index.iife.min.js" nomodule></script>
    <script nomodule>
        const ic = new IDBSideloader();
        ic.init().then(function() {
            ic.load();
            // Optionally trigger `onload` if there are scripts that depend on it.
            // document.dispatchEvent(new Event("load"))
        }).catch(function(err) {
            console.log("error loading indexed-cache", err)
        })
    </script>
```

#### Optional configuration

One or more of these optional params can be passed during initialization. Default values are shown below.

```javascript
new IDBSideloader({
    tags: ["script", "img", "link"],
    dbName: "indexed-cache",
    storeName: "objects",
    // If this is enabled, all objects in the cache with keys not
    // found on elements on the page (data-key) will be deleted.
    // This can be problematic in scenarios where there are multiple
    // pages on the same domain that have different assets, some on
    // certain pages and some on other.
    prune: false,
    // Enabling this skips IndexedDB caching entirely,
    // causing resources to be fetched over HTTP every time.
    // Useful in dev environments.
    skip: false,
    // Default expiry for an object in minutes (default 3 months).
    // Set to null for no expiry.
    expiry: 131400
}).load();
```

- `load()` can be called with a DOM Node or NodeList. When none are given, it scans the entire DOM.
- To manually prune all objects in the database except for a given list of keys, after `await init()`, call `.prune([list of keys])`.

## Use-cases

### For very specific scenarios only

This library is only meant to be used in very specific scenarios.

Unlike the browser's asset cache, IndexedDB is not cleared automatically, providing a longer term static file storage on the client side. The lib uses ES6 (and IndexedDB) and is only expected to work on recent versions of modern browsers. Ideally, this should have been handled with ServiceWorkers, but they don't work in mobile webviews.

Use if at least a few of these are true:

- There are large static files (JS, CSS) that rarely change.
- High traffic from a large number of returning users who access web pages with the same assets regularly and frequently.
- The pages are mostly inside mobile webviews where browser cache gets evicted  (OS pressure) causing the same assets to be fetched afresh over and over wasting bandwidth.
- Bandwidth is a concern.

### Features

- Supports script, img, link tags.
- Respects `defer / async` on script tags.
- Can invalidate cached items with a TTL per tag.
- Can invalidate cached items with a simple random hash per tag.

### Gotchas

- CORS.
- First-paint "flash" (needs to be handled manually) as scripts and styles only load after HTML is fetched and rendered by the browser.
- Browser compatibility.
- Empty space or line breaks between the opening and closing `<script data-src="remote.js"></script>` tags will be executed as an inline script by the browser, after which the browser will not load the remote script when applied. Ensure that the opening and closing script tags have nothing between then.
- Scripts that rely on the `document.onload` event will need the event to be triggered for them manually once indexed-cache loads with a `document.dispatchEvent(new Event("load"));`

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



# idb-sideloader.js

Licensed under the MIT license.

What is `idb-sideloader`? It's a tiny Javascript + TypeScript library that "sideloads" static assets (link, and img tags) on webpages using the fetch() API and caches them in an IndexedDB store to eliminate dependency on the standard browser static asset cache, and to eliminate HTTP requests on subsequent page loads. CSS and image assets are stored in IndexedDB as Blobs.

idb-sideloader makes use of [URLSearchParams Polyfill](https://github.com/jerrybendy/url-search-params-polyfill) for backward compatibility with browsers without support for `URLSearchParams.size` (i.e. Safari and some WebKit Chromium builds).

## Usage

To cache and sideload static assets:

- Change the original `src` (`href` for CSS) attribute on tags to `data-src`.
- Optionally give tags a unique ID with `data-key`. The cached items are stored in the database with this key. The actual filenames of the assets can change freely, like in the case of JS build systems.
- Load and invoke indexed-cache at the end.

#### Simplest Usage - Vanilla HTML + Javascript Global Object

```html
<head>
	<script src="https://cdn.jsdelivr.net/npm/idb-sideloader@2.0.0/dist/index.iife.min.js"></script>
</head>
<body>
	<img data-src="https://your-url.com/your-image.jpg" />
	<script type="text/javascript">
		const assetLoader = new IDBSideloader();
		assetLoader.load().catch(console.error);
	</script>
</body>
```

#### Simplest Usage - Vanilla HTML + ESM Javascript

```html
<body>
	<img data-src="https://your-url.com/your-image.jpg" />
	<script type="module">
		import IDBSideloader from 'https://cdn.jsdelivr.net/npm/idb-sideloader@2.0.0/+esm'
		const assetLoader = new IDBSideloader();
		assetLoader.load().catch(console.error);
	</script>
</body>
```

#### Example - React + Recoil

Use-cases include webapps, PWAs, module federation, and other use-cases.

This pattern is useful in situations where an PWA isn't feasible (i.e. extending low-code platforms with federated react component modules), but where we still want to provide the user with progressive data loading for static assets.

The example below shows the following:

1. Prime a lazily evaluated global state variable with an `IDBSideloader` cache object
2. Initializing the `IDBSideloader` cache object with a `useLayoutEffect` hook component on first app render
3. Load a cached images with a React `img` component wrapper

```tsx
import { FunctionComponent, useLayoutEffect } from 'react';
import { atom, selector, useRecoilValue } from 'recoil';
import IDBSideloader from 'idb-sideloader';

// Initialize async read-only selector. Selector evaluated lazily.
export const assetLoader = selector({
	key: 'asset-loader-selector',
	get: async () => {
		const ic = new IDBSideloader();
		await ic.load();
		return ic;
	},
});

// Effectfully load data on initial app render
export const IDBSideloaderInitEffect: FunctionComponent = () => {
  const sideloader = useRecoilValue(assetLoader);
  useLayoutEffect(
    () => {
			sideloader.load().catch(console.error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      /** once */
    ]
  );
  return null;
};

// Load cache data when user-actions load images into the DOM
export const StaticImg: FunctionComponent<
	DetailedHTMLProps<ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>
> = (props) => {
	const { src, onClick, otherProps } = props;
	const imgRef = useRef<HTMLImageElement>(null);
  const loader = useRecoilValue(idbImgStoreAtom);
	useLayoutEffect(() => {
			if (!imgRef) return;
			loader.load([imgRef]).catch(console.error);
	}, [loader, imgSrc]);
	return (<img ref={imgRef} data-src={src} {...otherProps} />)
};
```

#### Example - Load modern and legacy bundle conditionally

Here is an example on how to load modern(ESM) bundle and legacy bundle conditionally based on browser support.

```html
    <!-- Only modern browsers understand type=module and legacy browsers will skip this script -->
    <script type="module">
        // Use ESM bundle.
        import IDBSideloader from "https://cdn.jsdelivr.net/npm/idb-sideloader@2.0.0/+esm";
        const assetLoader = new IDBSideloader();
        assetLoader.load().catch(console.error);
    </script>

    <!-- This will only be executed on legacy browsers which doesn't support ES6 modules.
    Modern browsers ignore the script if its tagged `nomodule`. -->
    <script src="https://cdn.jsdelivr.net/npm/idb-sideloader@2.0.0/dist/index.iife.min.js" nomodule></script>
    <script nomodule>
        const ic = new IDBSideloader();
        const assetLoader = new IDBSideloader();
        assetLoader.load().catch(console.error);
    </script>
```

#### Optional configuration

One or more of these optional params can be passed during initialization. Default values are shown below.

```javascript
new IDBSideloader({
    tags: ["img", "link"],
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

## Use-case: persisted storage of static assets

Unlike the browser's asset cache, IndexedDB is not cleared automatically, providing a longer term static file storage on the client side.

Use if at least a few of these are true:

- There are large static files (Image, CSS) that rarely change.
- High traffic from a large number of returning users who access web pages with the same assets regularly and frequently.
- The pages are mostly inside mobile webviews where browser cache gets evicted (OS pressure) causing the same assets to be fetched afresh over and over wasting bandwidth.
- Bandwidth is a concern.
- We don't care if the data remains cached in the user's browser.

### Features

- Supports img, link tags.
- Respects `lazy` on image tags.
- Can invalidate cached items with a TTL per tag.
- Can invalidate cached items with a simple random hash per tag.

### Gotchas

- CORS.
- First-paint "flash" (needs to be handled manually) as scripts and styles only load after HTML is fetched and rendered by the browser.

Consider:

```css
img[src=""], img:not([src]) {
  opacity: 0;
}
```

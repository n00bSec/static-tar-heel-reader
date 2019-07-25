import * as idb from 'idb';

importScripts(
  "https://storage.googleapis.com/workbox-cdn/releases/4.3.1/workbox-sw.js"
);

declare const workbox: typeof import("workbox-sw");

workbox.loadModule("workbox-strategies");
workbox.loadModule("workbox-precaching");

// Keeping this db connection here means when clearing indexedDB,
// have to replace service worker.
let db: idb.IDBPDatabase;


self.addEventListener("install", async (event) => {
  // Calling claim() on clients results in DOM Error.
  // But skipWaiting() alone seems to do the job.
  (self as any).skipWaiting();
  db = await idb.openDB('upload-book', 1,{
    upgrade(db, oldVersion, newVersion, transaction){
        switch(oldVersion){
          case 0: // Default oldversion
          case 1:
            console.log("Creating object store.");
            db.createObjectStore("book-cover", {keyPath: 'id', autoIncrement: true});
            db.createObjectStore("book-html", {keyPath: 'id', autoIncrement: true});
        }
    },
  });
});

workbox.routing.registerRoute(
  /.jpg|.png/,
  new workbox.strategies.CacheFirst({
    cacheName: "img-cache",
    plugins: [
      new workbox.expiration.Plugin({
        maxAgeSeconds: 30 * 24 * 60 * 60
      })
    ]
  })
);

workbox.routing.registerRoute(
  /.html|.css|.js|.json/,
  new workbox.strategies.CacheFirst({
    cacheName: "html-cache",
    plugins: [
      new workbox.expiration.Plugin({
        maxAgeSeconds: 30 * 24 * 60 * 60
      })
    ]
  })
);

workbox.precaching.precacheAndRoute([
  "./find.html",
  "./find.css",
  "./index.html",
  "./choose.html",
  "./images/favorite.png",
  "./images/reviewed.png",
  "./images/BackArrow.png",
  "./images/NextArrow.png",
  "./book.js",
  "./site.css"
]);

workbox.routing.registerRoute(/.\/content\/index\/AllAvailable$/, async () => {
  let ids = getAllAvailableIDs();
  return new Response(await ids);
});

/** Routers for sharing and locally viewing other books. **/

/**
 * List all of the locally uploaded books by ID.
 * Return a JSON list of IDs to .
 */
workbox.routing.registerRoute(/.\/local\/list$/, async () => {
  let tx = db.transaction('book-cover', 'readonly');
  let covers = await tx.objectStore('book-cover').getAll();
  let output: Array<object> = [];
  covers.forEach((obj) => {
    output.push({id: obj.id, name: obj.name});
  })
  let json = JSON.stringify(output);
  return new Response(json, {status: 200, statusText: "OK"});
});

/**
 * Should be able to upload two file objects:
 * 1. HTML file of cover page.
 * 2. HTML file of book. 
 * 
 * TODO: I really don't like the idea of not sanitizing the uploaded HTML.
 *  But that's what the editor is expected to output.
 */
workbox.routing.registerRoute(/.\/local\/upload$/, async (req) => {
  return idb.openDB('upload-book', 1,{
    upgrade(db, oldVersion, newVersion, transaction){
        switch(oldVersion){
          case 0: // Default oldversion
          case 1:
            console.log("Creating object store.");
            db.createObjectStore("book-cover", {keyPath: 'id', autoIncrement: true});
            db.createObjectStore("book-html", {keyPath: 'id', autoIncrement: true});
        }
    },
  }).then(async (db) => {
    return req.event.request.formData().then(async (form: FormData) => {
      let coverTransaction = db.transaction('book-cover', 'readwrite');
      let storeCover = coverTransaction.objectStore('book-cover');
      // Must be object to insert key.
      let bookcover = {
        value: form.get("bookcover"), 
        name: form.get("name")
      }; 

      let coverResult = storeCover.add(bookcover);

      let bodyTransaction = db.transaction('book-html', 'readwrite');
      let storeBody = bodyTransaction.objectStore('book-html');
      let bookhtml = {
        value: form.get("bookhtml"), 
        name: form.get("name")
      };

      let bodyResult = storeBody.add(bookhtml);
      return new Response('Add performed.');
    }).catch((err: Error) => {
      return new Response('Error:' + err, {status: 500});
    });
  });

}, 'POST');

/**
 * Returns an HTML page for the given book, with the following specified:
 * - Books are stored in IndexedDB, and are fetched from it.
 * - Images are links if they point to already present images. They're Base64 encoded if not.
 */
workbox.routing.registerRoute(/.\/local\/getbody$/, async (request) => {
  let tx = db.transaction('book-html');
  tx.objectStore('book-html').get(1).then((res) => {

  });

  if (request.params){
    console.log(request.params);
  } else {
    return new Response('No params given.');
  }
  return new Response('');
}, 'POST');

workbox.routing.registerRoute(
  /.\/content\/index/,
  new workbox.strategies.CacheFirst({
    cacheName: "index-cache",
    plugins: [
      new workbox.expiration.Plugin({
        maxAgeSeconds: 30 * 24 * 60 * 60
      })
    ]
  })
);

// Fetches the available IDs.
async function getAllAvailableIDs(): Promise<string> {
  if (navigator.onLine) {
    let id_req = await fetch("./content/index/AllAvailable");
    if (id_req.ok) {
      return id_req.text();
    }
  }

  // Offline case.
  let ids: string = "";

  let cache = await caches.open("html-cache");
  let keys = await cache.keys();

  if (keys.length == 0) {
    return "";
  }

  keys.forEach((request, index, array) => {
    let url = request.url;
    if (!url.includes("content")) {
      return;
    }

    let tokens = url
      .substring(url.search("content") + "content".length)
      .split("/");

    if (!tokens[tokens.length - 1].match(/\d.html/)) {
      return;
    }

    let id = tokens.join("");
    id = id.substring(0, id.length - 5);
    ids += id;
  });

  return ids;
}
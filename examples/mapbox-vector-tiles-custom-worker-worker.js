import MVT from '../src/ol/format/MVT';
import CustomVectorTileLayer from './mapbox-vector-tiles-custom-worker-layer';
import VectorTileSource from '../src/ol/source/VectorTile.js';
import {createMapboxStreetsV6Style} from './resources/mapbox-streets-v6-style.js';
import {get as getProjection} from '../src/ol/proj.js';
import {Style, Fill, Stroke, Icon, Text} from '../src/ol/style';
import {loadImageUsingDom, setLoadImageHelper} from '../src/ol/loadImage';
import {setCanvasCreator} from '../src/ol/canvas';
import {setFontFamiliesHelper} from '../src/ol/css';
import {setMeasureTextHeightHelper} from '../src/ol/render/canvas';

// Return offscreen canvases instead of DOM based ones
setCanvasCreator(function() {
  return new self.OffscreenCanvas(150, 150);
});

// Disable font families logics as it is not available to workers
setFontFamiliesHelper(function() {
  return null;
});

// Disable text height measurement
// An improvement would to delegate the computation to the main thread
setMeasureTextHeightHelper(function() {
  return 12;
});


const waitingPromisesFunctions = {};
let counter = 0;

function continueWorkerImageLoading(opaqueId, img) {
  const functions = waitingPromisesFunctions[opaqueId];
  delete waitingPromisesFunctions[opaqueId];
  if (img) {
    functions.ok(img);
  } {
    functions.ko(img);
  }
}


function loadImageWithinWorker(src, options) {
  return new Promise(function(resolve, reject) {
    const opaqueId = ++counter;
    self.postMessage({
      action: 'loadImage',
      opaqueId,
      src,
      options
    });
    waitingPromisesFunctions[opaqueId] = {
      ok(img) {
        resolve(img);
      },
      ko() {
        reject();
      },
      src
    };
  });
}

setLoadImageHelper(function loadImage(src, options) {
  if (typeof Image === 'undefined') {
    return loadImageWithinWorker(src, options);
  }
  return loadImageUsingDom(src, options);
});

const key = 'pk.eyJ1IjoiYWhvY2V2YXIiLCJhIjoiRk1kMWZaSSJ9.E5BkluenyWQMsBLsuByrmg';

const layer = new CustomVectorTileLayer({
  declutter: false,
  useInterimTilesOnError: false,
  renderMode: 'image',
  source: new VectorTileSource({
    attributions: '© <a href="https://www.mapbox.com/map-feedback/">Mapbox</a> ' +
      '© <a href="https://www.openstreetmap.org/copyright">' +
      'OpenStreetMap contributors</a>',
    format: new MVT(),
    url: 'https://{a-d}.tiles.mapbox.com/v4/mapbox.mapbox-streets-v6/' +
        '{z}/{x}/{y}.vector.pbf?access_token=' + key
  }),
  style: createMapboxStreetsV6Style(Style, Fill, Stroke, Icon, Text)
});


const renderer = /** @type {CanvasVectorTileLayerRenderer} */ (layer.createRenderer());
const epsg3857 = getProjection('EPSG:3857');


/**
 * @param {number} messageId An opaque id from the main thread.
 * @param {string} tileId The tile uuid.
 * @param {VectorRenderTile} tile The rendered tile.
 */
function success(messageId, tileId, tile) {
  // Executors are not yet serializable.
  // So we render up-to a transferable canvas for now.
  const executorGroup = [];
  const bitmap = renderer.getTileImage(tile)['transferToImageBitmap']();

  self.postMessage({
    action: 'preparedTile',
    messageId: messageId,
    tileId: tileId,
    images: [bitmap],
    executorGroup: executorGroup
  }, [bitmap]);
}

function failure(messageId, tileId, tile) {
  self.postMessage({
    action: 'failedTilePreparation',
    state: tile.getState(),
    messageId: messageId,
    tileId: tileId
  });
}

self.onmessage = function(event) {
  console.log('Received event in worker', event.data);
  const action = event.data.action;
  if (action === 'prepareTile') {
    const {messageId, tileId, tileCoord, pixelRatio} = event.data;
    const [z, x, y] = tileCoord;
    renderer.prepareTileInWorker(z, x, y, pixelRatio, epsg3857, tileId).then(
      success.bind(null, messageId, tileId),
      failure.bind(null, messageId, tileId)
    );
  } else if (action === 'continueWorkerImageLoading') {
    const {opaqueId, image} = event.data;
    continueWorkerImageLoading(opaqueId, image);
  }
};

import Component from '@ember/component';
import PublicAPI from '../utils/public-api';
import layout from '../templates/components/g-map';
import { addEventListeners, parseOptionsAndEvents } from '../utils/options-and-events';
import { position as center } from '../utils/helpers';
import { inject as service } from '@ember/service';
import { computed, get, set } from '@ember/object';
import { not, reads, readOnly } from '@ember/object/computed';
import { guidFor } from '@ember/object/internals';
import { A } from '@ember/array';
import { tryInvoke } from '@ember/utils';
import { all, defer } from 'rsvp';
import { bind, scheduleOnce } from '@ember/runloop';
import { task } from 'ember-concurrency';

const GMapAPI = {
  id: 'mapId',
  map: 'map',
  components: 'components',
  actions: {
    update: '_updateMap',
    trigger: '_trigger',
  }
};

/**
 * @class GMap
 * @module ember-google-maps/components/g-map
 * @extends Ember.Component
 */
export default Component.extend({
  /**
   * @property googleMapsApi
   * @type GoogleMapsApi
   * @readOnly
   */
  googleMapsApi: service(),

  layout,

  tagName: '',

  /**
   * Zoom level for the map
   *
   * @property zoom
   * @type {Number}
   * @default 8
   * @public
   */
  zoom: 8,

  /**
   * The latitude and longitude of the center of the map.
   *
   * @property center
   * @type {google.maps.LatLng}
   * @public
   */
  center,

  google: reads('googleMapsApi.google'),

  mapComponent: reads('map'),

  /**
   * A unique id for the current map instance.
   *
   * @property mapId
   * @type {String}
   * @public
   */
  mapId: computed(function() {
    return `ember-google-map-${guidFor(this)}`;
  }),

  _hasCustomCanvas: false,

  _needsCanvas: not('_hasCustomCanvas'),

  _optionsAndEvents: parseOptionsAndEvents(),

  _options: readOnly('_optionsAndEvents.options'),

  _events: readOnly('_optionsAndEvents.events'),

  _createOptions(options) {
    return {
      ...options,
      center: get(this, 'center'),
      zoom: get(this, 'zoom'),
    };
  },

  _createEvents(events) {
    return events;
  },

  init() {
    this._super(...arguments);

    this.components = {};
    this.gMap = {};

    this.publicAPI = new PublicAPI(this, GMapAPI);

    this._internalAPI = {
      _registerCanvas: this._registerCanvas.bind(this),
      _registerComponent: this._registerComponent.bind(this),
      _unregisterComponent: this._unregisterComponent.bind(this)
    };

    this._canvasIsRendering = defer();
    this._eventListeners = new Map();

    get(this, '_initMap').perform();
  },

  didUpdateAttrs() {
    this._super(...arguments);

    if (get(this, 'map')) {
      let options = this._createOptions(get(this, '_options'));
      this._updateMap(options);
    }
  },

  willDestroyElement() {
    this._super(...arguments);

    this._eventListeners.forEach((remove) => remove());
  },

  /**
   * Initialize the map, register events and prep internal components.
   *
   * @method _initMap
   * @private
   * @return
   */
  _initMap: task(function *() {
    yield get(this, 'google');

    let canvas = yield this._canvasIsRendering.promise;

    let options = this._createOptions(get(this, '_options'));
    let map = new google.maps.Map(canvas.element, options);

    function waitForComponents() {
      if (this.isDestroying || this.isDestroyed) { return; }

      this._waitForComponents()
        .then(() => {
          this._componentsInitialized = true;
          tryInvoke(this, 'onComponentsLoad', [this.publicAPI]);
        });
    }

    function setupMap() {
      if (this.isDestroying || this.isDestroyed) { return; }

      set(this, 'map', map);

      let payload = {
        map: this.map,
        publicAPI: this.publicAPI,
      };

      addEventListeners(map, this._createEvents(get(this, '_events')), payload)
        .forEach(({ name, remove }) => this._eventListeners.set(name, remove));

      tryInvoke(this, 'onLoad', [this.publicAPI]);

      scheduleOnce('afterRender', this, waitForComponents);
    }

    google.maps.event.addListenerOnce(map, 'idle', bind(this, setupMap));
  }),

  _waitForComponents() {
    let componentsAreInitialized =
      Object.keys(this.components)
        .map((name) => this.components[name])
        .reduce((array, componentGroup) => array.concat(componentGroup), [])
        .map((components) => get(components, 'isInitialized.promise'));

    return all(componentsAreInitialized);
  },

  /**
   * Update the map options.
   *
   * @method _updateMap
   * @return
   */
  _updateMap(options) {
    get(this, 'map').setOptions(options);
  },

  /**
   * Helper method to trigger Google Maps events.
   *
   * @method _trigger
   * @param {String} event Event name
   * @return
   */
  _trigger(...args) {
    google.maps.event.trigger(get(this, 'map'), ...args);
  },

  _registerCanvas(canvas, isCustomCanvas) {
    set(this, 'canvas', canvas);
    set(this, '_hasCustomCanvas', isCustomCanvas);
    scheduleOnce('afterRender', this, '_notifyCanvasHasRendered');
  },

  _notifyCanvasHasRendered() {
    this._canvasIsRendering.resolve(this.canvas);
  },

  /**
   * Register a contextual component with the map component.
   *
   * @method _registerComponent
   * @param {String} type Plural name of the component
   * @param {Object} componentAPI
   * @return
   */
  _registerComponent(type, componentAPI) {
    this.components[type] = this.components[type] || A();
    this.components[type].pushObject(componentAPI);
  },

  /**
   * Unregister a contextual component with the map component.
   *
   * @method _unregisterComponent
   * @param {String} type Name of the component
   * @param {Object} componentAPI
   * @return
   */
  _unregisterComponent(type, componentAPI) {
    this.components[type].removeObject(componentAPI);
  },

  _updateGMap(...props) {
    let newGMap = Object.assign({}, this.gMap, ...props);
    scheduleOnce('afterRender', () => set(this, 'gMap', newGMap));
  }
});

import Service from '@ember/service';
import { get, set } from '@ember/object';
import { inject as service } from '@ember/service';
import { resolve } from 'rsvp';
const getApp = (service) => {
    const firebase = get(service, 'firebase');
    const name = get(service, 'name');
    return firebase.app(name);
};
export default class FirebaseAppService extends Service.extend({
    name: undefined,
    firebase: service('firebase')
}) {
    constructor() {
        super(...arguments);
        this.delete = () => getApp(this).delete();
        this.auth = () => resolve(import('firebase/auth')).then(() => getApp(this).auth());
        this.analytics = () => resolve(import('firebase/analytics')).then(() => getApp(this).analytics());
        this.firestore = () => resolve(import('firebase/firestore')).then(() => getApp(this).firestore());
        this.messaging = () => resolve(import('firebase/messaging')).then(() => getApp(this).messaging());
        this.performance = () => resolve(import('firebase/performance')).then(() => getApp(this).performance());
        this.remoteConfig = () => resolve(import('firebase/remote-config')).then(() => getApp(this).remoteConfig());
        this.database = (url) => resolve(import('firebase/database')).then(() => getApp(this).database(url));
        this.functions = (region) => resolve(import('firebase/functions')).then(() => getApp(this).functions(region));
        this.storage = (url) => resolve(import('firebase/storage')).then(() => getApp(this).storage(url));
    }
    init(...args) {
        // @ts-ignore because ember do pass arguments here
        super.init(...args);
        const app = getApp(this);
        set(this, 'options', app.options);
    }
}

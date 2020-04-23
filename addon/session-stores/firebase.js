import Evented from '@ember/object/evented';
import EmberObject from '@ember/object';
import { get, set } from '@ember/object';
import { Promise, resolve } from 'rsvp';
import { run } from '@ember/runloop';
import { inject as service } from '@ember/service';
export default class FirebaseSessionStore extends EmberObject.extend(Evented, {
    firebaseApp: service('firebase-app')
}) {
    constructor() {
        super(...arguments);
        this.restoring = true;
        this.persist = resolve;
        this.clear = resolve;
    }
    restore() {
        return new Promise(resolve => {
            get(this, 'firebaseApp').auth().then(auth => auth.onIdTokenChanged(user => run(() => {
                let authenticated = user ? { authenticator: 'authenticator:firebase', user, credential: user.getIdToken() } : {};
                if (get(this, 'restoring')) {
                    set(this, 'restoring', false);
                    resolve({ authenticated });
                }
                else {
                    this.trigger('sessionDataUpdated', { authenticated });
                }
            })));
        });
    }
}

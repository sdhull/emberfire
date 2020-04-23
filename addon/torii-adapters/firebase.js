import EmberObject from '@ember/object';
import { inject as service } from '@ember/service';
import { get } from '@ember/object';
import { Promise, reject, resolve } from 'rsvp';
import { run } from '@ember/runloop';
export default class FirebaseToriiAdapter extends EmberObject.extend({
    firebaseApp: service('firebase-app')
}) {
    open(user) {
        return resolve(user);
    }
    restore() {
        return new Promise(resolve => {
            get(this, 'firebaseApp').auth().then(auth => {
                const unsubscribe = auth.onIdTokenChanged(currentUser => run(() => {
                    unsubscribe();
                    if (currentUser) {
                        resolve({ currentUser });
                    }
                    else {
                        reject();
                    }
                }));
            });
        });
    }
    close() {
        return get(this, 'firebaseApp').auth().then(auth => auth.signOut());
    }
}

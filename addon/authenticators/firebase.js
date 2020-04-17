import RSVP from 'rsvp';
const { resolve, reject } = RSVP;
import { inject as service } from '@ember/service';
import EmberObject, { get } from '@ember/object';
import Evented from '@ember/object/evented';
export default class FirebaseAuthenticator extends EmberObject.extend(Evented, {
    firebaseApp: service('firebase-app'),
}) {
    restore(data) {
        return resolve(data);
    }
    authenticate() {
        return reject(new Error('Please authenticate via the Firebase SDK directly.'));
    }
    invalidate() {
        return get(this, 'firebaseApp').auth().then(auth => auth.signOut());
    }
}

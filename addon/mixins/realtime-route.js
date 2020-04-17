import Mixin from '@ember/object/mixin';
import { subscribe, unsubscribe } from '../services/realtime-listener';
// TODO make sure realtime works on findAll
//      handle includes
export default Mixin.create({
    afterModel(model) {
        subscribe(this, model);
        return this._super(model);
    },
    deactivate() {
        unsubscribe(this);
        return this._super();
    }
});

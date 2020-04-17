import DS from 'ember-data';
export default class RealtimeDatabaseSerializer extends DS.JSONSerializer {
    normalizeSingleResponse(store, primaryModelClass, payload, _id, _requestType) {
        if (!payload.exists) {
            throw new DS.NotFoundError();
        }
        let normalized = normalize(store, primaryModelClass, payload);
        this.applyTransforms(primaryModelClass, normalized.data.attributes);
        return normalized;
    }
    normalizeArrayResponse(store, primaryModelClass, payload, _id, _requestType) {
        const normalizedPayload = [];
        payload.forEach(snapshot => {
            let normalized = normalize(store, primaryModelClass, snapshot);
            this.applyTransforms(primaryModelClass, normalized.data.attributes);
            normalizedPayload.push(normalized);
        });
        const included = new Array().concat(...normalizedPayload.map(({ included }) => included));
        const meta = { query: payload.query || payload.ref };
        const data = normalizedPayload.map(({ data }) => data);
        return { data, included, meta };
    }
    normalizeCreateRecordResponse(_store, _primaryModelClass, payload, id, _requestType) {
        return { data: { id: id || payload.ref.key, attributes: payload.data } };
    }
}
export const normalize = (store, modelClass, snapshot) => {
    const id = snapshot.key;
    const type = modelClass.modelName;
    const attributes = Object.assign(Object.assign({}, snapshot.val()), { _ref: snapshot.ref });
    const { relationships, included } = normalizeRelationships(store, modelClass, attributes);
    const data = { id, type, attributes, relationships };
    return { data, included };
};
const normalizeRelationships = (store, modelClass, attributes) => {
    const relationships = {};
    const included = [];
    modelClass.eachRelationship((key, relationship) => {
        const attribute = attributes[key];
        delete attributes[key];
        relationships[key] = normalizeRealtionship(relationship)(store, attribute, relationship, included);
    }, null);
    return { relationships, included };
};
const normalizeRealtionship = (relationship) => {
    if (relationship.kind === 'belongsTo') {
        return normalizeBelongsTo;
    }
    else if (relationship.options.embedded) {
        return normalizeEmbedded;
    }
    else {
        return normalizeHasMany;
    }
};
const normalizeBelongsTo = (_store, attribute, relationship, _included) => {
    if (attribute) {
        return { data: { id: attribute, type: relationship.type } };
    }
    else {
        return {};
    }
};
const normalizeEmbedded = (store, attribute, relationship, included) => {
    if (attribute) {
        Object.keys(attribute).forEach(key => {
            const val = attribute[key];
            const snapshot = { key, val: () => val };
            const model = store.modelFor(relationship.type);
            const { data, included: includes } = normalize(store, model, snapshot);
            included.push(data);
            includes.forEach(record => included.push(record));
        });
        const data = included
            .filter(record => record.type == relationship.type)
            .map(record => ({ id: record.id, type: record.type }));
        return { links: { related: 'emberfire' }, data };
    }
    else {
        return {};
    }
};
const normalizeHasMany = (_store, _attribute, _relationship, _included) => ({ links: { related: 'emberfire' } });

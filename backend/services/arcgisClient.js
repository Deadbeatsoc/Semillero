import {
  fetchLocalPredictions,
  LocalPredictionEngineError
} from './localPredictionEngine.js';

class ArcgisClientError extends LocalPredictionEngineError {}

const fetchArcgisPredictions = async (filters = {}) => {
  const { data } = await fetchLocalPredictions(filters);
  return data;
};

export { ArcgisClientError, fetchArcgisPredictions };

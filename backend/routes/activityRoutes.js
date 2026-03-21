import { Router } from 'express';
import { registerPageVisit } from '../controllers/activityController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const activityRouter = Router();

activityRouter.use(requireAuth);
activityRouter.post('/visit', registerPageVisit);

export default activityRouter;

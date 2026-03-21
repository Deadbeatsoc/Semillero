import { Router } from 'express';
import {
  createReportRequest,
  getApprovedReportsForToday
} from '../controllers/reportController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const reportRouter = Router();

reportRouter.use(requireAuth);
reportRouter.get('/', getApprovedReportsForToday);
reportRouter.post('/', createReportRequest);

export default reportRouter;

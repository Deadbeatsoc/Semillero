import { Router } from 'express';
import {
  getDashboard,
  getVerificationCode,
  regenerateVerificationCode
} from '../controllers/adminController.js';
import {
  approveReportRequest,
  getPendingReports
} from '../controllers/adminReportController.js';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware.js';

const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);
adminRouter.get('/dashboard', getDashboard);
adminRouter.get('/verification-code', getVerificationCode);
adminRouter.post('/verification-code/regenerate', regenerateVerificationCode);
adminRouter.get('/reports/pending', getPendingReports);
adminRouter.post('/reports/:id/approve', approveReportRequest);

export default adminRouter;

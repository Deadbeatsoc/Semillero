import { Router } from 'express';
import { login, logout, me, register } from '../controllers/authController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.get('/me', requireAuth, me);
authRouter.post('/logout', requireAuth, logout);

export default authRouter;

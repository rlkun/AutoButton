import { Router } from 'express';

const router = Router();

// Mock verify route
router.post('/verify', (req, res) => {
  // Always return success for now
  res.status(200).json({
    success: true,
    message: 'Valid license',
    data: {
      userId: 'mock-user-123',
      expiresAt: '2099-12-31T23:59:59Z',
    }
  });
});

export default router;

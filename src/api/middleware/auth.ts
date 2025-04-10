import { Request, Response, NextFunction } from 'express';
import { supabase } from '../../lib/supabase';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
  };
}

export const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'No authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    (req as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email || ''
    };

    next();
  } catch (error) {
    res.status(500).json({
      message: 'Authentication failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default { authenticateUser }; 
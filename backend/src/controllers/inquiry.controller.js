import prisma from '../lib/prisma.js';

export const createInquiry = async (req, res, next) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    // Constrain input lengths
    if (name.length > 100 || email.length > 255 || message.length > 5000) {
      return res.status(400).json({ error: 'Input exceeds maximum allowed length' });
    }

    const inquiry = await prisma.inquiry.create({
      data: { name, email, message },
    });

    res.status(201).json({ message: 'Your inquiry has been cast into the void. We shall respond if the stars align.' });
  } catch (error) {
    next(error);
  }
};

export const adminGetInquiries = async (req, res, next) => {
  try {
    const inquiries = await prisma.inquiry.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(inquiries);
  } catch (error) {
    next(error);
  }
};

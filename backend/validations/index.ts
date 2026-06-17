const { z } = require('zod');

const loginSchema = z.object({
  username: z.string().email('Invalid email format').optional(),
  password: z.string().min(1, 'Password is required').optional(),
  id: z.string().optional(),
  role: z.string().optional()
}).refine(data => (data.username && data.password) || (data.id && data.role), {
  message: 'Either username+password or id+role must be provided'
});

const patientLoginSchema = z.object({
  patientId: z.string().min(1, 'patientId is required'),
  preferredLanguage: z.string().optional()
});

const authLoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional()
});

const dispenseSchema = z.object({
  patientId: z.string().min(1, 'patientId is required'),
  medicineId: z.string().min(1, 'medicineId is required'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  nextVisitDate: z.string().optional(),
  notes: z.string().optional()
});

const walkinSchema = z.object({
  patientId: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional()
});

const livekitTokenSchema = z.object({
  roomName: z.string().min(1, 'roomName is required'),
  participantName: z.string().min(1, 'participantName is required'),
  isCounselor: z.boolean().optional()
});

const notifyCallSchema = z.object({
  fcmToken: z.string().min(1, 'fcmToken is required'),
  roomName: z.string().optional(),
  callerName: z.string().optional()
});

module.exports = {
  loginSchema,
  patientLoginSchema,
  authLoginSchema,
  dispenseSchema,
  walkinSchema,
  livekitTokenSchema,
  notifyCallSchema
};

export {};

import { withTransaction } from '../db/mysqlPool.js';
import {
  countAdmins,
  createRegistrationCode,
  createUser,
  findUserByUsername,
  getActiveRegistrationCode
} from '../models/authModel.js';
import {
  assertValidUsername,
  generateVerificationCode,
  hashPassword,
  normalizeUsername
} from './authSecurity.js';

const resolveAdminBaseUsername = () => {
  const envValue = normalizeUsername(process.env.ADMIN_DEFAULT_USERNAME || 'admin');
  const validationError = assertValidUsername(envValue);
  if (validationError) {
    return 'admin';
  }
  return envValue;
};

const resolveAdminPassword = () => {
  const envValue = String(process.env.ADMIN_DEFAULT_PASSWORD || '').trim();
  if (envValue.length >= 8) {
    return envValue;
  }
  return 'admin12345';
};

const resolveInitialCode = () => {
  const envValue = String(process.env.ADMIN_INITIAL_VERIFICATION_CODE || '').trim();
  if (/^\d{6,12}$/.test(envValue)) {
    return envValue;
  }
  return generateVerificationCode();
};

const bootstrapAuthData = async () =>
  withTransaction(async (connection) => {
    const adminCount = await countAdmins(connection);
    let createdAdmin = null;
    let activeCode = await getActiveRegistrationCode(connection);
    let createdCode = false;

    if (adminCount === 0) {
      const baseUsername = resolveAdminBaseUsername();
      const adminPassword = resolveAdminPassword();
      let username = baseUsername;
      let suffix = 1;

      while (true) {
        const existing = await findUserByUsername(connection, username);
        if (!existing) {
          break;
        }
        if (existing.role === 'admin') {
          createdAdmin = {
            username: existing.username,
            generatedPassword: null,
            reusedExisting: true
          };
          break;
        }
        username = `${baseUsername}${suffix}`;
        suffix += 1;
      }

      if (!createdAdmin) {
        await createUser(connection, {
          username,
          passwordHash: hashPassword(adminPassword),
          role: 'admin'
        });
        createdAdmin = {
          username,
          generatedPassword: adminPassword,
          reusedExisting: false
        };
      }
    }

    if (!activeCode) {
      const codeValue = resolveInitialCode();
      await createRegistrationCode(connection, {
        codeValue,
        generatedByUserId: null
      });
      activeCode = {
        code_value: codeValue
      };
      createdCode = true;
    }

    return {
      createdAdmin,
      activeCode: String(activeCode.code_value),
      createdCode
    };
  });

export { bootstrapAuthData };

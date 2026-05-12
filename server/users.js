import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function parseUsersFromJson(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((u) => ({
        username: String(u.username || "").trim(),
        passwordHash: String(u.passwordHash || hashPassword(u.password || "")),
        masterName: String(u.masterName || "").trim(),
        role: String(u.role || "master").trim()
      }))
      .filter((u) => u.username && u.passwordHash && (u.role === "admin" || u.masterName));
  } catch {
    return [];
  }
}

let users = parseUsersFromJson(config.usersJson);

function serializeUsersForEnv() {
  return JSON.stringify(
    users.map((u) => ({
      username: u.username,
      passwordHash: u.passwordHash,
      masterName: u.masterName,
      role: u.role
    }))
  );
}

function persistUsersToEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) throw new Error("服务器缺少 .env 文件，无法保存用户");
  const envText = fs.readFileSync(envPath, "utf8");
  const nextLine = `REPAIR_USERS_JSON=${serializeUsersForEnv()}`;
  const replaced = envText.match(/^REPAIR_USERS_JSON=.*$/m)
    ? envText.replace(/^REPAIR_USERS_JSON=.*$/m, nextLine)
    : `${envText.trim()}\n${nextLine}\n`;
  fs.writeFileSync(envPath, replaced, "utf8");
}

export function verifyUser(username, password) {
  const user = users.find((u) => u.username === String(username || "").trim());
  if (!user) return null;
  const passwordHash = hashPassword(password || "");
  if (passwordHash !== user.passwordHash) return null;
  return {
    username: user.username,
    role: user.role,
    masterName: user.masterName
  };
}

export function hasUsers() {
  return users.length > 0;
}

export function listUsersSafe() {
  return users.map((u) => ({
    username: u.username,
    role: u.role,
    masterName: u.masterName
  }));
}

export function createUser({ username, password, role, masterName }) {
  const nextUsername = String(username || "").trim();
  const nextPassword = String(password || "").trim();
  const nextRole = String(role || "master").trim();
  const nextMasterName = String(masterName || "").trim();

  if (!nextUsername) throw new Error("账号不能为空");
  if (!nextPassword) throw new Error("密码不能为空");
  if (nextRole !== "admin" && nextRole !== "master") throw new Error("角色仅支持 admin/master");
  if (nextRole === "master" && !nextMasterName) throw new Error("师傅账号必须绑定维修师傅");
  if (users.some((u) => u.username === nextUsername)) throw new Error("账号已存在");

  users.push({
    username: nextUsername,
    passwordHash: hashPassword(nextPassword),
    role: nextRole,
    masterName: nextRole === "admin" ? "" : nextMasterName
  });

  persistUsersToEnv();

  return {
    username: nextUsername,
    role: nextRole,
    masterName: nextRole === "admin" ? "" : nextMasterName
  };
}

-- Freelance Control Centre — MySQL schema
-- Run this once in phpMyAdmin or: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS fcc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fcc;

CREATE TABLE IF NOT EXISTS fcc_task_columns (
  id          VARCHAR(64)  PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  color       VARCHAR(20),
  position    INT          DEFAULT 0,
  created_at  VARCHAR(64),
  updated_at  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS fcc_tasks (
  id          VARCHAR(64)  PRIMARY KEY,
  title       VARCHAR(500) NOT NULL,
  description TEXT,
  column_id   VARCHAR(64),
  project_id  VARCHAR(64),
  color       VARCHAR(20),
  labels      TEXT,               -- JSON array e.g. ["Video","Edit"]
  due_date    VARCHAR(20),
  position    INT          DEFAULT 0,
  created_at  VARCHAR(64),
  updated_at  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS fcc_projects (
  id          VARCHAR(64)  PRIMARY KEY,
  title       VARCHAR(255),
  name        VARCHAR(255),
  status      VARCHAR(50),
  notes       TEXT,
  created_at  VARCHAR(64),
  updated_at  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS fcc_clients (
  id               VARCHAR(64)  PRIMARY KEY,
  name             VARCHAR(255),
  email            VARCHAR(255),
  phone            VARCHAR(50),
  company          VARCHAR(255),
  type             VARCHAR(20)  DEFAULT 'client',
  notes            TEXT,
  last_contacted   VARCHAR(20),
  follow_up_date   VARCHAR(20),
  created_at       VARCHAR(64),
  updated_at       VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS fcc_collaborators (
  id               VARCHAR(64)  PRIMARY KEY,
  name             VARCHAR(255),
  email            VARCHAR(255),
  phone            VARCHAR(50),
  role             VARCHAR(255),
  notes            TEXT,
  last_contacted   VARCHAR(20),
  follow_up_date   VARCHAR(20),
  created_at       VARCHAR(64),
  updated_at       VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS fcc_project_clients (
  project_id  VARCHAR(64) NOT NULL,
  client_id   VARCHAR(64) NOT NULL,
  PRIMARY KEY (project_id, client_id)
);

CREATE TABLE IF NOT EXISTS fcc_project_collaborators (
  project_id       VARCHAR(64) NOT NULL,
  collaborator_id  VARCHAR(64) NOT NULL,
  PRIMARY KEY (project_id, collaborator_id)
);

CREATE TABLE IF NOT EXISTS fcc_documents (
  id          VARCHAR(64)  PRIMARY KEY,
  title       VARCHAR(255),
  content     TEXT,
  type        VARCHAR(50),
  project_id  VARCHAR(64),
  created_at  VARCHAR(64),
  updated_at  VARCHAR(64)
);

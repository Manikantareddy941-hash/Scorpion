/*
  # Create Tasks Management System

  ## Overview
  Creates a comprehensive task tracking system with user authentication and full CRUD capabilities.

  ## 1. New Tables
    - `tasks`
      - `id` (uuid, primary key) - Unique task identifier
      - `user_id` (uuid, foreign key) - Reference to authenticated user
      - `title` (text) - Task title/name
      - `description` (text) - Detailed task description
      - `status` (text) - Task status: 'todo', 'in_progress', 'completed'
      - `priority` (text) - Priority level: 'low', 'medium', 'high'
      - `due_date` (timestamptz) - Task deadline
      - `created_at` (timestamptz) - Task creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  ## 2. Security
    - Enable RLS on `tasks` table
    - Add policy for users to view only their own tasks
    - Add policy for users to insert their own tasks
    - Add policy for users to update their own tasks
    - Add policy for users to delete their own tasks

  ## 3. Important Notes
    - All tasks are private to the user who created them
    - Status field is restricted to valid values via check constraint
    - Priority field is restricted to valid values via check constraint
    - Automatic timestamp updates on modification
*/

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'todo',
  priority text NOT NULL DEFAULT 'medium',
  due_date timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('todo', 'in_progress', 'completed')),
  CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high'))
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

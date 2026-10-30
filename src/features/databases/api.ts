import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { DatabaseConnectionInput } from "@/types/models";

export const databaseKeys = {
  connections: ["database-connections"] as const,
  detail: (id: string) => ["database-connection", id] as const,
  schema: (id: string) => ["database-schema", id] as const,
};

export function useDatabaseConnections() {
  return useQuery({
    queryKey: databaseKeys.connections,
    queryFn: ipc.databases.list,
  });
}

export function useCreateDatabaseConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DatabaseConnectionInput) => ipc.databases.create(input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: databaseKeys.connections,
      }),
  });
}

export function useUpdateDatabaseConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: DatabaseConnectionInput;
    }) => ipc.databases.update(id, input),
    onSuccess: (connection) => {
      queryClient.invalidateQueries({ queryKey: databaseKeys.connections });
      queryClient.invalidateQueries({
        queryKey: databaseKeys.detail(connection.id),
      });
      queryClient.invalidateQueries({
        queryKey: databaseKeys.schema(connection.id),
      });
    },
  });
}

export function useDeleteDatabaseConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.databases.remove(id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: databaseKeys.connections,
      }),
  });
}

export function useTestDatabaseConnection() {
  return useMutation({
    mutationFn: (id: string) => ipc.databases.test(id),
  });
}

export function useDatabaseSchema(id: string) {
  return useQuery({
    queryKey: databaseKeys.schema(id),
    queryFn: () => ipc.databases.schema(id),
  });
}

export function useExecuteDatabaseQuery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sql }: { id: string; sql: string }) =>
      ipc.databases.execute(id, sql),
    onSuccess: (result, { id }) => {
      if (result.columns.length === 0) {
        queryClient.invalidateQueries({ queryKey: databaseKeys.schema(id) });
      }
    },
  });
}

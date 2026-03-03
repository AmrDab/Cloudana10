// Simplified query client to avoid wallet dependencies
export const queryClient = {
  // Mock query client for development
  getQueryData: () => null,
  setQueryData: () => {},
  invalidateQueries: () => {},
} as any;
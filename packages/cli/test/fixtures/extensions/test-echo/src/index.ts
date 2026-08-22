export default {
  handlers: {
    "test.echo": async (_ctx: unknown, input: { value: string }) => ({
      data: { echoed: input.value },
    }),
  },
};

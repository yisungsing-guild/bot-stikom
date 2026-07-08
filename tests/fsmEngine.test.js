// Tests for the numeric FSM menu engine.

jest.mock('../src/db', () => ({
  session: {
    findUnique: jest.fn(),
    upsert: jest.fn()
  },
  menuItem: {
    findFirst: jest.fn(),
    findMany: jest.fn()
  }
}));

describe('FSM engine', () => {
  let prisma;
  let handleFSM;
  let upsertSession;

  beforeEach(() => {
    jest.resetModules();
    prisma = require('../src/db');
    ({ handleFSM, upsertSession } = require('../src/engine/fsm'));

    jest.clearAllMocks();
  });

  test('upsertSession does not overwrite Session.data when data is omitted', async () => {
    await upsertSession('chat1', 'root.1');

    expect(prisma.session.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.session.upsert.mock.calls[0][0];

    expect(call).toEqual({
      where: { chatId: 'chat1' },
      create: { chatId: 'chat1', state: 'root.1' },
      update: { state: 'root.1' }
    });
  });

  test('upsertSession overwrites Session.data only when explicitly provided', async () => {
    await upsertSession('chat1', 'root.1', { keep: true });

    expect(prisma.session.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.session.upsert.mock.calls[0][0];

    expect(call).toEqual({
      where: { chatId: 'chat1' },
      create: { chatId: 'chat1', state: 'root.1', data: { keep: true } },
      update: { state: 'root.1', data: { keep: true } }
    });
  });

  test('handleFSM numeric selection updates state and returns menu text (without wiping data)', async () => {
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'chat1',
      state: 'root',
      data: { messages: [{ direction: 'user', message: 'hi' }] }
    });

    prisma.menuItem.findFirst.mockResolvedValueOnce({
      id: 'm1',
      key: 'root.1',
      text: 'SUBMENU_TEXT'
    });

    const reply = await handleFSM('chat1', '1');

    expect(reply).toBe('SUBMENU_TEXT');
    expect(prisma.menuItem.findFirst).toHaveBeenCalledWith({ where: { key: 'root.1' } });

    // Ensure we only update state, do not stomp Session.data.
    expect(prisma.session.upsert).toHaveBeenCalledWith({
      where: { chatId: 'chat1' },
      create: { chatId: 'chat1', state: 'root.1' },
      update: { state: 'root.1' }
    });
  });

  test('handleFSM "menu" works from non-root state and lists only top-level root.<digit> items (first line as label)', async () => {
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'chat1',
      state: 'root.9',
      data: { messages: [{ direction: 'user', message: 'prev' }] }
    });

    prisma.menuItem.findMany.mockResolvedValueOnce([
      { key: 'root.1', text: 'Akademik & Kemahasiswaan\n5. Organisasi', order: 1 },
      { key: 'root.1.5', text: 'Organisasi & UKM', order: 2 },
      { key: 'root.2', text: 'Biaya & Pendaftaran', order: 3 }
    ]);

    const reply = await handleFSM('chat1', 'menu');

    expect(reply).toBe('1. Akademik & Kemahasiswaan\n2. Biaya & Pendaftaran');

    // Reset to root should only update state.
    expect(prisma.session.upsert).toHaveBeenCalledWith({
      where: { chatId: 'chat1' },
      create: { chatId: 'chat1', state: 'root' },
      update: { state: 'root' }
    });
  });
});

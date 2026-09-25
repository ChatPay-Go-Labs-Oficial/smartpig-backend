jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
import { ValidationPipe } from '@nestjs/common';
import { AnswerQuestionDto, LearningController } from './learning.controller';
import { LearningService } from './learning.service';

it('rejects points, correctness and user identity supplied in an answer payload', async () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  await expect(
    pipe.transform(
      {
        questionId: 'q',
        optionId: 'a',
        version: 1,
        points: 1000,
        correct: true,
        userId: 'victim',
      },
      { type: 'body', metatype: AnswerQuestionDto },
    ),
  ).rejects.toThrow();
});

it('uses the authenticated identity to award points', async () => {
  const service = {
    resolveUserId: jest.fn().mockResolvedValue('verified-user'),
    answer: jest.fn(),
  };
  const controller = new LearningController(
    service as unknown as LearningService,
  );
  await controller.answer({ id: 'did:privy:alice' }, 1, {
    questionId: 'q',
    optionId: 'a',
    version: 1,
  });
  expect(service.resolveUserId).toHaveBeenCalledWith('did:privy:alice');
  expect(service.answer).toHaveBeenCalledWith('verified-user', 1, 'q', 'a', 1);
});

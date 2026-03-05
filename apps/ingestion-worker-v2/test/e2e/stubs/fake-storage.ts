type StoredObject = {
  payload: string;
  contentType?: string;
};

type SaveOptions = {
  contentType?: string;
};

export class FakeBucketFile {
  public constructor(
    private readonly objects: Map<string, StoredObject>,
    private readonly objectPath: string,
  ) {}

  public async save(payload: string | Buffer, options?: SaveOptions): Promise<void> {
    this.objects.set(this.objectPath, {
      payload: typeof payload === 'string' ? payload : payload.toString('utf8'),
      contentType: options?.contentType,
    });
  }

  public async download(): Promise<[Buffer]> {
    const object = this.objects.get(this.objectPath);
    if (!object) {
      throw new Error(`Object "${this.objectPath}" does not exist in fake bucket.`);
    }

    return [Buffer.from(object.payload, 'utf8')];
  }
}

export class FakeBucket {
  private readonly objects = new Map<string, StoredObject>();

  public file(objectPath: string): FakeBucketFile {
    return new FakeBucketFile(this.objects, objectPath);
  }

  public seed(objectPath: string, payload: string, contentType?: string): void {
    this.objects.set(objectPath, {
      payload,
      contentType,
    });
  }

  public read(objectPath: string): StoredObject | undefined {
    return this.objects.get(objectPath);
  }

  public listObjectPaths(): string[] {
    const paths: string[] = [];
    this.objects.forEach((_value, key) => {
      paths.push(key);
    });
    return paths;
  }
}

export class FakeStorage {
  private readonly buckets = new Map<string, FakeBucket>();

  public bucket(name: string): FakeBucket {
    const existing = this.buckets.get(name);
    if (existing) {
      return existing;
    }

    const created = new FakeBucket();
    this.buckets.set(name, created);
    return created;
  }
}

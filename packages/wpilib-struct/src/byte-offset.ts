export class ByteOffset {
	private offset: number;

	constructor(offset = 0) {
		this.offset = offset;
	}

	get(): number {
		return this.offset;
	}

	advance(bytes: number): ByteOffset {
		this.offset += bytes;
		return this;
	}

	advance8(): ByteOffset {
		return this.advance(1);
	}

	advance16(): ByteOffset {
		return this.advance(2);
	}

	advance32(): ByteOffset {
		return this.advance(4);
	}

	advance64(): ByteOffset {
		return this.advance(8);
	}
}

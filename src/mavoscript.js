(function($, val, $u) {

var _ = Mavo.Script = {
	addUnaryOperator: function(name, o) {
		if (o.symbol) {
			// Build map of symbols to function names for easy rewriting
			for (let symbol of Mavo.toArray(o.symbol)) {
				Mavo.Script.symbols[symbol] = name;
			}
		}

		return Mavo.Functions[name] = operand => Array.isArray(operand)? operand.map(val).map(o.scalar) : o.scalar(val(operand));
	},

	/**
	 * Extend a scalar operator to arrays, or arrays and scalars
	 * The operation between arrays is applied element-wise.
	 * The operation operation between a scalar and an array will result in
	 * the operation being applied between the scalar and every array element.
	 */
	addBinaryOperator: function(name, o) {
		if (o.symbol) {
			// Build map of symbols to function names for easy rewriting
			for (let symbol of Mavo.toArray(o.symbol)) {
				Mavo.Script.symbols[symbol] = name;
			}
		}

		o.identity = o.identity === undefined? 0 : o.identity;

		return Mavo.Functions[name] = o.code || function(...operands) {
			if (operands.length === 1) {
				if (Array.isArray(operands[0])) {
					// Operand is an array of operands, expand it out
					operands = [...operands[0]];
				}
			}

			if (!o.raw) {
				operands = operands.map(val);
			}

			var prev = o.logical? o.identity : operands[0], result;

			for (let i = 1; i < operands.length; i++) {
				let a = o.logical? operands[i - 1] : prev;
				let b = operands[i];

				if (Array.isArray(b)) {
					if (typeof o.identity == "number") {
						b = $u.numbers(b);
					}

					if (Array.isArray(a)) {
						result = [
							...b.map((n, i) => o.scalar(a[i] === undefined? o.identity : a[i], n)),
							...a.slice(b.length)
						];
					}
					else {
						result = b.map(n => o.scalar(a, n));
					}
				}
				else if (Array.isArray(a)) {
					result = a.map(n => o.scalar(n, b));
				}
				else {
					result = o.scalar(a, b);
				}

				if (o.reduce) {
					prev = o.reduce(prev, result, a, b);
				}
				else if (o.logical) {
					prev = prev && result;
				}
				else {
					prev = result;
				}
			}

			return prev;
		};
	},

	/**
	 * Mapping of operator symbols to function name.
	 * Populated via addOperator() and addLogicalOperator()
	 */
	symbols: {},

	getOperatorName: op => Mavo.Script.symbols[op] || op,

	/**
	 * Operations for elements and scalars.
	 * Operations between arrays happen element-wise.
	 * Operations between a scalar and an array will result in the operation being performed between the scalar and every array element.
	 * Ordered by precedence (higher to lower)
	 * @param scalar {Function} The operation between two scalars
	 * @param identity The operation’s identity element. Defaults to 0.
	 */
	operators: {
		"not": {
			symbol: "!",
			scalar: a => !a
		},
		"multiply": {
			scalar: (a, b) => a * b,
			identity: 1,
			symbol: "*"
		},
		"divide": {
			scalar: (a, b) => a / b,
			identity: 1,
			symbol: "/"
		},
		"add": {
			scalar: (a, b) => +a + +b,
			symbol: "+"
		},
		"subtract": {
			scalar: (a, b) => {
				if (isNaN(a) || isNaN(b)) {
					var dateA = $u.date(a), dateB = $u.date(b);

					if (dateA && dateB) {
						return (dateA - dateB)/1000;
					}
				}

				return a - b;
			},
			symbol: "-"
		},
		"mod": {
			scalar: (a, b) => {
				var ret = a % b;
				ret += ret < 0? b : 0;
				return ret;
			}
		},
		"lte": {
			logical: true,
			scalar: (a, b) => {
				[a, b] = Mavo.Script.getNumericalOperands(a, b);
				return a <= b;
			},
			identity: true,
			symbol: "<="
		},
		"lt": {
			logical: true,
			scalar: (a, b) => {
				[a, b] = Mavo.Script.getNumericalOperands(a, b);
				return a < b;
			},
			identity: true,
			symbol: "<"
		},
		"gte": {
			logical: true,
			scalar: (a, b) => {
				[a, b] = Mavo.Script.getNumericalOperands(a, b);
				return a >= b;
			},
			identity: true,
			symbol: ">="
		},
		"gt": {
			logical: true,
			scalar: (a, b) => {
				[a, b] = Mavo.Script.getNumericalOperands(a, b);
				return a > b;
			},
			identity: true,
			symbol: ">"
		},
		"eq": {
			logical: true,
			scalar: (a, b) => a == b,
			symbol: ["=", "=="],
			identity: true
		},
		"neq": {
			logical: true,
			scalar: (a, b) => a != b,
			symbol: ["!="],
			identity: true
		},
		"and": {
			logical: true,
			scalar: (a, b) => !!a && !!b,
			identity: true,
			symbol: "&&"
		},
		"or": {
			logical: true,
			scalar: (a, b) => a || b,
			reduce: (p, r) => p || r,
			identity: false,
			symbol: "||"
		},
		"concatenate": {
			symbol: "&",
			identity: "",
			scalar: (a, b) => "" + (a || "") + (b || "")
		},
		// Filter is listed here because it's an easy way to handle multiple
		// array filters without having to code it
		"filter": {
			scalar: (a, b) => val(b)? a : null,
			raw: true
		}
	},

	getNumericalOperands: function(a, b) {
		if (isNaN(a) || isNaN(b)) {
			// Try comparing as dates
			var da = $u.date(a), db = $u.date(b);

			if (da && db) {
				// Both valid dates
				return [da, db];
			}
		}

		return [a, b];
	},

	/**
	 * These serializers transform the AST into JS
	 */
	serializers: {
		"BinaryExpression": node => `${_.serialize(node.left)} ${node.operator} ${_.serialize(node.right)}`,
		"UnaryExpression": node => `${node.operator}${_.serialize(node.argument)}`,
		"CallExpression": node => `${_.serialize(node.callee)}(${node.arguments.map(_.serialize).join(", ")})`,
		"ConditionalExpression": node => `${_.serialize(node.test)}? ${_.serialize(node.consequent)} : ${_.serialize(node.alternate)}`,
		"MemberExpression": node => {
			var property = node.computed? _.serialize(node.property) : `"${node.property.name}"`;
			return `get(${_.serialize(node.object)}, ${property})`;
		},
		"ArrayExpression": node => `[${node.elements.map(_.serialize).join(", ")}]`,
		"Literal": node => node.raw,
		"Identifier": node => node.name,
		"ThisExpression": node => "this",
		"Compound": node => node.body.map(_.serialize).join(" ")
	},

	/**
	 * These are run before the serializers and transform the expression to support MavoScript
	 */
	transformations: {
		"BinaryExpression": node => {
			let name = Mavo.Script.getOperatorName(node.operator);

			// Flatten same operator calls
			var nodeLeft = node;
			var args = [];

			do {
				args.unshift(nodeLeft.right);
				nodeLeft = nodeLeft.left;
			} while (Mavo.Script.getOperatorName(nodeLeft.operator) === name);

			args.unshift(nodeLeft);

			if (args.length > 1) {
				return `${name}(${args.map(_.serialize).join(", ")})`;
			}
		},
		"UnaryExpression": node => {
			var name = Mavo.Script.getOperatorName(node.operator);

			if (name) {
				return `${name}(${_.serialize(node.argument)})`;
			}
		},
		"CallExpression": node => {
			if (node.callee.type == "Identifier") {
				if (node.callee.name == "if") {
					node.callee.name = "iff";
				}

				node.callee.name = "Mavo.Functions._Trap." + node.callee.name;
			}
		}
	},

	serialize: node => {
		var ret = _.transformations[node.type] && _.transformations[node.type](node);

		if (ret !== undefined) {
			return ret;
		}

		return _.serializers[node.type](node);
	},

	rewrite: function(code) {
		try {
			return _.serialize(_.parse(code));
		}
		catch (e) {
			// Parsing as MavoScript failed, falling back to plain JS
			return code;
		}
	},

	compile: function(code) {
		code = _.rewrite(code);

		return new Function("data", `with(Mavo.Functions._Trap)
				with (data || {}) {
					return ${code};
				}`);
	},

	parse: self.jsep,
};

if (self.jsep) {
	jsep.addBinaryOp("and", 2);
	jsep.addBinaryOp("or", 2);
	jsep.addBinaryOp("=", 6);
	jsep.addBinaryOp("mod", 10);
	jsep.removeBinaryOp("===");
}

_.serializers.LogicalExpression = _.serializers.BinaryExpression;
_.transformations.LogicalExpression = _.transformations.BinaryExpression;

for (let name in Mavo.Script.operators) {
	let details = Mavo.Script.operators[name];

	if (details.scalar.length < 2) {
		Mavo.Script.addUnaryOperator(name, details);
	}
	else {
		Mavo.Script.addBinaryOperator(name, details);
	}
}

})(Bliss, Mavo.value, Mavo.Functions.util);
